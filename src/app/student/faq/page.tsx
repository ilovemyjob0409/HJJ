import Link from 'next/link';
import { listFaqItems } from '@/lib/services/faqService';
import Card from '@/components/ui/Card';

// Without this, Next.js prerenders this page once at build time and
// serves that frozen snapshot to every student until the next deploy.
export const dynamic = 'force-dynamic';

export default async function StudentFaqPage() {
  const items = await listFaqItems();

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">常見問題</h1>

      <Link href="/guide">
        <Card className="mb-4 transition-shadow hover:shadow-md">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-ink">系統使用教學</p>
              <p className="mt-0.5 text-sm text-inkMuted">請假、補課、集點、報名的完整圖文步驟說明</p>
            </div>
            <span className="shrink-0 text-inkMuted">→</span>
          </div>
        </Card>
      </Link>

      {items.length === 0 ? (
        <Card>
          <p className="text-sm text-inkMuted">尚未新增常見問題</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <details key={item.id} className="group rounded-xl border border-borderSubtle bg-card p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-ink [&::-webkit-details-marker]:hidden">
                {item.question}
                <span className="ml-2 shrink-0 text-inkMuted transition-transform group-open:rotate-180">▾</span>
              </summary>
              <p className="mt-3 whitespace-pre-wrap text-sm text-inkMuted">{item.answer}</p>
            </details>
          ))}
        </div>
      )}
    </>
  );
}
