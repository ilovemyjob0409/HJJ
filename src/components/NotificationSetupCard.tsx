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

async function bindSubscriptionToCurrentUser(subscription: PushSubscription): Promise<Response> {
  return fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...subscription.toJSON(), userAgent: navigator.userAgent }),
  });
}

type SetupState = 'loading' | 'hidden' | 'ios-install' | 'prompt' | 'subscribed' | 'denied';

export default function NotificationSetupCard() {
  const { showToast } = useToast();
  const [state, setState] = useState<SetupState>('loading');
  const [enabling, setEnabling] = useState(false);
  const [disabling, setDisabling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
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
      if (Notification.permission === 'granted' && subscription) {
        // 以伺服器為準：只有此帳號真的有綁定才顯示已開啟並刷新綁定資料；
        // 「關閉」過的帳號不會被自動重綁，手足帳號首次使用要按一次開啟。
        const res = await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(subscription.endpoint)}`);
        if (cancelled) return;
        if (res.ok && (await res.json()).subscribed) {
          await bindSubscriptionToCurrentUser(subscription);
          if (!cancelled) setState('subscribed');
          return;
        }
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
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
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
      setState('prompt');
    } catch {
      showToast('關閉通知失敗，請稍後再試');
    } finally {
      setDisabling(false);
    }
  }, [showToast]);

  if (state === 'loading' || state === 'hidden') return null;

  if (state === 'subscribed') {
    return (
      <p className="mb-4 text-xs text-inkMuted">
        ✓ 通知已開啟（此裝置）
        <button type="button" onClick={disable} disabled={disabling} className="ml-2 underline hover:text-ink disabled:opacity-50">
          關閉
        </button>
      </p>
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
