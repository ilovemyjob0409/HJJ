'use client';

export interface Prize {
  id: string;
  name: string;
  points: number;
  stock: number;
  imageUrl: string | null;
  thumbUrl: string | null;
  alreadyRedeemed: boolean;
}

type PrizeStatus = 'ready' | 'short' | 'redeemed' | 'soldOut';

function statusOf(prize: Prize, total: number): PrizeStatus {
  if (prize.alreadyRedeemed) return 'redeemed';
  if (prize.stock === 0) return 'soldOut';
  return prize.points > total ? 'short' : 'ready';
}

function PrizeImage({ prize, className }: { prize: Prize; className: string }) {
  if (!prize.thumbUrl) {
    return (
      <span className={`flex items-center justify-center bg-stripe text-3xl ${className}`} aria-hidden="true">
        🎁
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- Supabase render URL, already resized server-side
  return <img src={prize.thumbUrl} alt="" loading="lazy" decoding="async" className={`object-cover ${className}`} />;
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const ratio = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className="mt-2.5 block h-2 overflow-hidden rounded-full bg-borderSubtle"
    >
      <span className="block h-full origin-left rounded-full bg-brand" style={{ transform: `scaleX(${ratio})` }} />
    </span>
  );
}

// 學生端獎品目錄（展示櫃版）：頂部「下一個目標」＝點數不夠的獎品中最接近的一個；
// 下方照片滿版方格，能換的加琥珀光圈。兌換一律從詳情彈窗進行（點方格開詳情）。
export default function PrizeCatalog({
  prizes,
  total,
  redeemingId,
  onView,
}: {
  prizes: Prize[];
  total: number;
  redeemingId: string | null;
  onView: (prize: Prize) => void;
}) {
  const nextGoal = prizes
    .filter((p) => statusOf(p, total) === 'short')
    .sort((a, b) => a.points - b.points)[0];

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-bold text-ink">獎品目錄</h2>
        <p className="shrink-0 text-sm text-inkMuted">
          我的點數 <span className="text-base font-bold text-brandDark">{total}</span>
        </p>
      </div>

      {prizes.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-2xl border border-borderStrong bg-card px-4 py-8 text-center shadow-sm">
          <span className="text-3xl" aria-hidden="true">
            🎁
          </span>
          <p className="text-sm font-semibold text-ink">獎品還在準備中</p>
          <p className="text-xs text-inkMuted">先把點數存起來，上架後就能馬上兌換</p>
        </div>
      ) : (
        <>
          {nextGoal && (
            <button
              type="button"
              onClick={() => onView(nextGoal)}
              className="mb-4 flex w-full cursor-pointer items-center gap-4 rounded-2xl border border-brand/60 bg-card p-4 text-left shadow-sm"
            >
              <PrizeImage prize={nextGoal} className="h-20 w-20 shrink-0 rounded-xl sm:h-24 sm:w-24" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold text-brandDark">🎯 下一個目標</span>
                <span className="mt-0.5 block truncate font-bold text-ink">{nextGoal.name}</span>
                <ProgressBar value={total} max={nextGoal.points} />
                <span className="mt-1.5 flex items-baseline justify-between gap-2 text-sm text-inkMuted">
                  <span>
                    再集 <span className="font-bold text-ink">{nextGoal.points - total}</span> 點就能換到！
                  </span>
                  <span className="shrink-0 text-xs">
                    {total} / {nextGoal.points}
                  </span>
                </span>
              </span>
            </button>
          )}

          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {prizes.map((prize) => {
              const status = statusOf(prize, total);
              const redeeming = redeemingId === prize.id;
              return (
                <li key={prize.id}>
                  <button
                    type="button"
                    onClick={() => onView(prize)}
                    aria-label={`查看「${prize.name}」詳情`}
                    aria-busy={redeeming}
                    className={`relative block aspect-square w-full cursor-pointer overflow-hidden rounded-2xl border border-borderStrong bg-stripe text-left shadow-sm ${
                      status === 'ready' ? 'ring-2 ring-brand ring-offset-2 ring-offset-background' : ''
                    }`}
                  >
                    <PrizeImage
                      prize={prize}
                      className={`h-full w-full ${status === 'soldOut' ? 'grayscale' : ''} ${
                        status === 'redeemed' || status === 'soldOut' ? 'opacity-60' : ''
                      }`}
                    />
                    {status === 'redeemed' && (
                      <span className="absolute left-2 top-2 rounded-full bg-approvedBg px-2 py-0.5 text-xs font-bold text-approved">
                        ✓ 已兌換
                      </span>
                    )}
                    {status === 'soldOut' && (
                      <span className="absolute left-2 top-2 rounded-full bg-black/65 px-2 py-0.5 text-xs font-bold text-white">
                        已換完
                      </span>
                    )}
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-3 pb-2.5 pt-10">
                      <span className="line-clamp-2 text-sm font-semibold leading-5 text-white">{prize.name}</span>
                      <span className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-brandInk">{prize.points} 點</span>
                        {status === 'ready' && <span className="text-xs font-bold text-white">可兌換 ›</span>}
                        {status === 'short' && <span className="text-xs text-white/85">差 {prize.points - total} 點</span>}
                      </span>
                    </span>
                    {redeeming && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/45">
                        <span
                          aria-hidden
                          className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent"
                        />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
