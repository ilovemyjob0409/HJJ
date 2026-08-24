// 個別輔導額度顯示（版本甲）：一行摘要＋分段進度條。行政新增預約彈窗、學生
// 個別輔導頁、學生儀表板票券管理共用，數字口徑一律：已計次 locked／額度
// quota、已預約 upcoming、剩餘可約 = quota - locked - upcoming。
// selectedCount＝日曆上已勾選還沒送出的天數，剩餘會即時扣給行政看。
// pendingOverQuota＝超過額度、送行政審核中的預約筆數，另外列出、不佔「剩餘可約」。
interface TutoringQuotaBarProps {
  locked: number;
  upcoming: number;
  quota: number;
  pendingOverQuota?: number;
  selectedCount?: number;
  dense?: boolean; // 儀表板列的緊湊版：字級縮小、細進度條
}

export default function TutoringQuotaBar({ locked, upcoming, quota, pendingOverQuota = 0, selectedCount = 0, dense }: TutoringQuotaBarProps) {
  const remaining = quota - locked - upcoming - selectedCount;
  const pct = (n: number) => (quota > 0 ? Math.min(100, (n / quota) * 100) : 0);
  return (
    <div className="w-full">
      <p className={`${dense ? 'text-xs' : 'text-sm'} text-inkMuted`}>
        本月已計次 <b className="font-semibold text-ink">{locked}</b>／{quota} 堂・已預約{' '}
        <b className="font-semibold text-ink">{upcoming}</b> 堂
        {pendingOverQuota > 0 && (
          <>
            ・超額待審 <b className="font-semibold text-pending">{pendingOverQuota}</b> 堂
          </>
        )}
        {selectedCount > 0 && <>・已選 {selectedCount} 天</>}・
        {remaining >= 0 ? (
          <span className="font-semibold text-brandDark">剩餘可約 {remaining} 堂</span>
        ) : (
          <span className="font-semibold text-rejected">超出額度 {-remaining} 堂</span>
        )}
      </p>
      <div className={`${dense ? 'mt-1 h-1' : 'mt-2 h-1.5'} flex overflow-hidden rounded-full bg-stripe`}>
        <div className="h-full bg-brand" style={{ width: `${pct(locked)}%` }} />
        <div className="h-full bg-brandDark opacity-70" style={{ width: `${pct(upcoming + selectedCount)}%` }} />
        {pendingOverQuota > 0 && <div className="h-full bg-pending opacity-80" style={{ width: `${pct(pendingOverQuota)}%` }} />}
      </div>
    </div>
  );
}
