'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';

// 個別輔導收費標準及規範（2026-08-20 與負責人定稿 v2：週 2 堂制＋補課制，
// 取代原月 8 堂遞延制）。注意：系統的額度計算仍是舊的「月 8 堂出席制」，
// 個輔補課流程也尚未重建——新條文的週堂數與補課目前由櫃檯人工執行，
// 系統對齊列為後續工程。修改條文時同步確認營運端做得到再改。
const RULES: { title: string; body: string }[] = [
  {
    title: '收費方式',
    body: '個別輔導採月費制，自每月 1 號起算，每月 3,000 元，表定每週固定 2 堂。',
  },
  {
    title: '繳費期限',
    body: '每月 5 號前繳費；10 號前仍未繳費者，暫停預約與補課資格，補繳後恢復。連續兩期未繳視同退班。',
  },
  {
    title: '每週堂數與月費',
    body: '表定每週固定 2 堂。月費固定 3,000 元，不因當月週數多寡調整——當月若有五週，多出的堂數照常上課、不另收費。',
  },
  {
    title: '缺席與補課',
    body: '當週未上滿 2 堂者，缺少的堂數以補課處理：請透過系統預約補課時段（或洽櫃檯安排），並於次月月底前補完，逾期視同放棄，不退費、不遞延。補課當日缺席，該次補課資格即失效。',
  },
  {
    title: '未預約到場',
    body: '未預約直接到場者，由櫃檯或老師視當日名額現場登記；當日名額已滿時得婉拒或改約他日。',
  },
  {
    title: '退班',
    body: '退班不退費、不折現；已繳當期可上課至該月月底，未完成之補課於退班時一併失效。',
  },
];

export default function TutoringPolicyModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        個別輔導收費標準及規範
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="個別輔導收費標準及規範" maxWidthClassName="max-w-xl">
        <ol className="flex flex-col gap-4">
          {RULES.map((rule, i) => (
            <li key={rule.title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brandInk">
                {i + 1}
              </span>
              <div>
                <p className="font-semibold text-ink">{rule.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-inkMuted">{rule.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Modal>
    </>
  );
}
