'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';

// 個別輔導收費標準及規範（2026-08 與負責人定稿的營運規則）。
// 扣堂邏輯（有預約且到場才扣堂、取消不計次、無補課）系統已照此執行；
// 遞延堂數、繳費凍結、未來預約上限目前由櫃檯人工執行——修改條文時
// 同步確認營運端做得到再改。
const RULES: { title: string; body: string }[] = [
  {
    title: '收費方式',
    body: '個別輔導採月費制，自每月 1 號起算，每月 3,000 元、固定 8 堂課。',
  },
  {
    title: '繳費期限',
    body: '每月 5 號前繳費；10 號前仍未繳費者，暫停預約資格並凍結遞延堂數，補繳後恢復。連續兩期未繳視同退班。',
  },
  {
    title: '堂數遞延',
    body: '當月未上完的堂數可遞延至下一期使用（下一期仍收全額 3,000 元，遞延不折抵費用）；遞延堂數至多累積 8 堂，超過部分於當月月底歸零。',
  },
  {
    title: '扣堂與缺席',
    body: '有預約且到場上課才扣堂；預約未到不扣堂、亦無需補課。每人同時最多保留 4 筆未來預約，屢次預約未到者，櫃檯得暫停其預約資格。',
  },
  {
    title: '未預約到場',
    body: '未預約直接到場者，由櫃檯或老師視當日名額現場登記；登記後視同已預約，到場即扣堂。當日名額已滿時得婉拒或改約他日。',
  },
  {
    title: '退班',
    body: '退班不退費、遞延堂數不折現；已繳最後一期之堂數（含遞延）可使用至該期月底止。',
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
