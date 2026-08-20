'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';

// 個別輔導收費標準及規範（2026-08-20 與負責人定稿 v4：週 2 堂制＋缺課補課制，
// 取代原月 8 堂遞延制）。缺席處理：學生在行事曆取消自己已排定的課（可取消
// 未來日期＝可預先補），於次月月底前完成補課；逾期不補、不退費。未取消、
// 逕自未到課者不提供補課。
// 注意：系統目前仍是舊的「月 8 堂出席制」——固定排課（依星期自動生成預約）、
// 每週堂數上限（可依學生設定）、補課期限都還沒實作，新條文目前全靠櫃檯人工
// 執行，系統對齊列為後續工程。修改條文時同步確認營運端做得到再改。
const RULES: { title: string; body: string }[] = [
  {
    title: '收費方式',
    body: '個別輔導採月費制，自每月 1 號起算，每月 3,000 元，原則上每週上課 2 堂，月費不因當月週數多寡調整（遇五週之月，多出的堂數不另收費）。缺課則安排補課（詳見下方「缺席與補課」）。',
  },
  {
    title: '繳費期限',
    body: '每月 5 號前繳費；10 號前仍未繳費者，暫停預約與補課資格，補繳後恢復。連續兩期未繳視同退班。',
  },
  {
    title: '缺席與補課',
    body: '如遇當週無法出席，請於系統行事曆取消該堂課（可提前取消未來日期），並於次月月底前完成補課；逾期不補、不退費。未經取消、逕自未到課者，不提供補課。',
  },
  {
    title: '未預約到場',
    body: '未預約直接到場者，由櫃檯或老師視當日名額現場登記；額滿得婉拒或改約他日。',
  },
  {
    title: '退班',
    body: '退班不退費、不折現；已繳當期可上課至該月月底，未完成之補課一併失效。',
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
