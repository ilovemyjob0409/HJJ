'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import BatchWizardModal from './BatchWizardModal';
import StandaloneBillModal from './StandaloneBillModal';
import ClosedDaysTab from './ClosedDaysTab';
import SettingsTab from './SettingsTab';
import OverviewTab from './OverviewTab';

type TabKey = 'overview' | 'closedDays' | 'settings';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '總覽' },
  { key: 'closedDays', label: '停課日' },
  { key: 'settings', label: '設定' },
];

const KIND_LABEL: Record<'CLASS' | 'TUTORING', string> = { CLASS: '圍棋班級', TUTORING: '英數個別輔導' };

interface BatchRow {
  id: string;
  kind: 'CLASS' | 'TUTORING';
  periodStart: string;
  periodEnd: string;
  status: 'DRAFT' | 'FINALIZED';
  totalDue: number | null;
  totalPaid: number | null;
  totalOutstanding: number | null;
}

export default function AdminBillingPage() {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>('overview');
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [standaloneModalOpen, setStandaloneModalOpen] = useState(false);
  // 單獨開單建立成功後讓總覽 refetch（總覽自己管資料，這裡只發刷新訊號）
  const [overviewRefreshKey, setOverviewRefreshKey] = useState(0);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabIndicatorRef = useRef<HTMLSpanElement>(null);
  const indicatorPositionedRef = useRef(false);

  // 子導航滑動底線定位：量測 active 分頁鈕，同 AppShell nav pill 的手法。
  // ResizeObserver 盯著各鈕——webfont 串流進來後字寬會變，底線要跟著校正。
  useLayoutEffect(() => {
    const bar = tabBarRef.current;
    const indicator = tabIndicatorRef.current;
    if (!bar || !indicator) return;
    const positionIndicator = () => {
      const activeBtn = bar.querySelector<HTMLButtonElement>('button[data-active="true"]');
      if (!activeBtn) return;
      indicator.style.opacity = '1';
      indicator.style.width = `${activeBtn.offsetWidth}px`;
      indicator.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
      if (!indicatorPositionedRef.current) {
        indicator.style.transitionDuration = '0s';
        requestAnimationFrame(() => {
          indicator.style.transitionDuration = '';
        });
        indicatorPositionedRef.current = true;
      }
    };
    positionIndicator();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(positionIndicator);
    bar.querySelectorAll('button').forEach((b) => observer.observe(b));
    return () => observer.disconnect();
  }, [tab]);

  // 批次分頁已移除：批次帳單的個別操作都在總覽的收費清單表；這裡只剩
  // 「草稿批次」需要一個回得去的入口（草稿不會出現在總覽，放著會變孤兒）。
  useEffect(() => {
    fetch('/api/admin/billing/batches')
      .then((res) => (res.ok ? res.json() : []))
      .then(setBatches)
      .catch(() => setBatches([]));
  }, []);

  const draftBatches = batches.filter((b) => b.status === 'DRAFT');

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink">收費</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setWizardOpen(true)}>＋ 開新批次</Button>
          <Button variant="secondary" onClick={() => setStandaloneModalOpen(true)}>
            單獨開單
          </Button>
        </div>
      </div>

      <div ref={tabBarRef} className="relative mb-4 flex gap-1 border-b border-borderSubtle">
        {/* 滑動底線：同 AppShell nav pill 的作法——絕對定位、量測 active 鈕的
            offsetLeft/offsetWidth 移動，首次掛載直接定位不滑入。 */}
        <span
          ref={tabIndicatorRef}
          className="pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-brand opacity-0 transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        />
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            data-active={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`cursor-pointer whitespace-nowrap px-4 py-2 text-sm font-semibold transition-colors ${
              tab === t.key ? 'text-brandDark' : 'text-inkMuted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div key="overview" className="animate-rise-in">
          {draftBatches.length > 0 && (
            <Card className="mb-4">
              <p className="mb-2 text-sm font-bold text-ink">草稿批次（尚未定案）</p>
              <ul className="flex flex-col gap-1">
                {draftBatches.map((b) => (
                  <li key={b.id}>
                    <Button variant="link" onClick={() => router.push(`/admin/billing/${b.id}`)}>
                      {KIND_LABEL[b.kind]}・{formatDateWithWeekday(b.periodStart)} ～ {formatDateWithWeekday(b.periodEnd)} →
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <OverviewTab refreshKey={overviewRefreshKey} />
        </div>
      )}
      {tab === 'closedDays' && (
        <div key="closedDays" className="animate-rise-in">
          <ClosedDaysTab />
        </div>
      )}
      {tab === 'settings' && (
        <div key="settings" className="animate-rise-in">
          <SettingsTab />
        </div>
      )}

      <BatchWizardModal open={wizardOpen} onClose={() => setWizardOpen(false)} />
      <StandaloneBillModal
        open={standaloneModalOpen}
        onClose={() => setStandaloneModalOpen(false)}
        onCreated={() => {
          setStandaloneModalOpen(false);
          setOverviewRefreshKey((k) => k + 1);
        }}
      />
    </>
  );
}
