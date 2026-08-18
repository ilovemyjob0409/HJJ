'use client';

import AlertModal from '@/components/ui/AlertModal';
import { WEEKDAY_LABELS } from '@/lib/dateFormat';

// 星期防呆共用彈窗的內容描述：各表單只填名稱／星期／用詞，
// 句型與視覺（警示圖示＋金色星期）統一由這裡出。
export interface WeekdayAlertInfo {
  // 彈窗標題，如「插班日期選錯了」
  title: string;
  // 主詞，如班級名稱或「這個時段」
  name: string;
  weekday: number;
  // 日期的稱呼，如「插班日期」「請假日期」「停開日」；預設「日期」
  noun?: string;
  // 主詞與星期的關係動詞，預設「上課」；停開日用「開課」
  verb?: string;
}

export default function WeekdayAlertModal({ info, onClose }: { info: WeekdayAlertInfo | null; onClose: () => void }) {
  const label = info ? WEEKDAY_LABELS[info.weekday] : '';
  return (
    <AlertModal open={info !== null} onClose={onClose} title={info?.title ?? ''}>
      {info && (
        <>
          <span className="font-semibold text-ink">{info.name}</span>是
          <span className="font-semibold text-brandDark">週{label}</span>
          {info.verb ?? '上課'}，
          <br />
          你選的{info.noun ?? '日期'}不是週{label}，請重新選擇。
        </>
      )}
    </AlertModal>
  );
}
