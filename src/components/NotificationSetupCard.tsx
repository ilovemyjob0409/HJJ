'use client';

import { useCallback, useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

// Web Push 公鑰要轉成 PushManager.subscribe 接受的 Uint8Array。
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from(rawData, (c) => c.charCodeAt(0));
}

// VAPID 公鑰輪換後，舊訂閱用舊金鑰簽出來的推播會被推播閘道 403 拒絕——
// 比對訂閱當初綁的金鑰，不同就先退掉，讓使用者重新訂閱。
function matchesCurrentKey(subscription: PushSubscription, publicKey: string): boolean {
  const bound = subscription.options.applicationServerKey;
  if (!bound) return true;
  const expected = urlBase64ToUint8Array(publicKey);
  const actual = new Uint8Array(bound);
  return actual.length === expected.length && actual.every((byte, i) => byte === expected[i]);
}

async function bindSubscriptionToCurrentUser(subscription: PushSubscription): Promise<Response> {
  return fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...subscription.toJSON(), userAgent: navigator.userAgent }),
  });
}

type SetupState = 'loading' | 'hidden' | 'ios-install' | 'prompt' | 'subscribed' | 'off' | 'denied';

// iOS 風格膠囊開關：綠色滑層用 opacity、圓鈕用 transform，遵守全站動效慣例
//（只動 transform/opacity）。demo 頁與通知卡共用。
export function NotificationToggle({ on, busy, onToggle }: { on: boolean; busy: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={on ? '關閉通知' : '開啟通知'}
      onClick={onToggle}
      disabled={busy}
      className="relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full bg-borderStrong disabled:cursor-wait disabled:opacity-60"
    >
      <span
        aria-hidden
        className={`absolute inset-0 rounded-full bg-[#34C759] transition-opacity duration-200 ${on ? 'opacity-100' : 'opacity-0'}`}
      />
      <span
        aria-hidden
        className={`relative ml-1 inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${on ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  );
}

export default function NotificationSetupCard() {
  const { showToast } = useToast();
  const [state, setState] = useState<SetupState>('loading');
  const [enabling, setEnabling] = useState(false);
  const [disabling, setDisabling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) {
        setState('hidden');
        return;
      }
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        // iOS Safari（未加入主畫面）沒有 PushManager——引導安裝；其他舊瀏覽器直接隱藏。
        const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
        const standalone = 'standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true;
        setState(isIos && !standalone ? 'ios-install' : 'hidden');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      if (cancelled) return;
      if (Notification.permission === 'denied') {
        setState('denied');
        return;
      }
      const subscription = await registration.pushManager.getSubscription();
      if (cancelled) return;
      let activeSubscription = subscription;
      if (activeSubscription && !matchesCurrentKey(activeSubscription, publicKey)) {
        await activeSubscription.unsubscribe().catch(() => {});
        activeSubscription = null;
      }
      if (Notification.permission === 'granted' && activeSubscription) {
        // 以伺服器為準：只有此帳號真的有綁定才顯示已開啟並刷新綁定資料；
        // 「關閉」過的帳號不會被自動重綁，手足帳號首次使用要按一次開啟。
        const res = await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(activeSubscription.endpoint)}`);
        if (cancelled) return;
        if (res.ok && (await res.json()).subscribed) {
          await bindSubscriptionToCurrentUser(activeSubscription);
          if (!cancelled) setState('subscribed');
        } else {
          // 這台裝置設定過通知（瀏覽器訂閱存在），只是此帳號沒綁定
          //（關閉過、或手足帳號首次登入）——顯示關閉狀態的開關，一撥即開。
          setState('off');
        }
        return;
      }
      setState('prompt');
    }
    init().catch(() => setState('hidden'));
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setEnabling(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'prompt');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !matchesCurrentKey(subscription, publicKey)) {
        await subscription.unsubscribe().catch(() => {});
        subscription = null;
      }
      subscription =
        subscription ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));
      const res = await bindSubscriptionToCurrentUser(subscription);
      if (res.ok) {
        setState('subscribed');
      } else {
        showToast('開啟通知失敗，請稍後再試');
      }
    } catch {
      showToast('開啟通知失敗，請稍後再試');
    } finally {
      setEnabling(false);
    }
  }, [showToast]);

  const disable = useCallback(async () => {
    // 只解除「這個帳號」的綁定，瀏覽器訂閱保留——同裝置其他手足帳號不受影響。
    setDisabling(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const res = await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!res.ok) throw new Error('unsubscribe failed');
      }
      setState('off');
    } catch {
      showToast('關閉通知失敗，請稍後再試');
    } finally {
      setDisabling(false);
    }
  }, [showToast]);

  if (state === 'loading' || state === 'hidden') return null;

  if (state === 'subscribed' || state === 'off') {
    const on = state === 'subscribed';
    return (
      <div className="mb-4 flex items-center gap-3 text-sm text-inkMuted">
        <span>推播通知（此裝置）</span>
        <NotificationToggle on={on} busy={enabling || disabling} onToggle={on ? disable : enable} />
      </div>
    );
  }

  return (
    <Card className="mb-6 animate-rise-in">
      <h2 className="mb-1 font-bold text-ink">開啟通知</h2>
      {state === 'ios-install' && (
        <p className="text-sm text-inkMuted">
          iPhone 請先用 Safari 開啟本網站，點「分享」→「加入主畫面」，之後從主畫面開啟 MUP，再回到這裡開啟通知。
        </p>
      )}
      {state === 'denied' && (
        <p className="text-sm text-inkMuted">通知權限已被封鎖：請到瀏覽器設定允許本網站的通知，再重新整理此頁。</p>
      )}
      {state === 'prompt' && (
        <>
          <p className="mb-3 text-sm text-inkMuted">
            開啟後，簽到簽退、補課結果、堂數提醒等重要訊息會直接推播到這支裝置。
          </p>
          <Button onClick={enable} loading={enabling}>
            開啟通知
          </Button>
        </>
      )}
    </Card>
  );
}
