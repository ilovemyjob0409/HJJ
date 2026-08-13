'use client';

import { useEffect } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';

// 全站的最後一道防線：目前整個專案沒有任何 error boundary，畫面渲染時若丟出
// 未捕捉的例外，React 會整棵樹解除掛載，使用者只會看到空白畫面——在點名 kiosk
// 這種無人值守的裝置上尤其危險（工作人員只會覺得「系統沒反應」）。這裡攔下來
// 顯示明確訊息＋重試按鈕，並把錯誤印到 console 方便之後用瀏覽器工具排查。
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md text-center">
        <p className="text-lg font-bold text-ink">畫面發生錯誤</p>
        <p className="mt-2 text-sm text-inkMuted">請按下方按鈕重試；如果持續發生，請告知行政人員並附上瀏覽器主控台（F12）看到的錯誤訊息。</p>
        <Button onClick={reset} className="mt-4">
          重試
        </Button>
      </Card>
    </div>
  );
}
