import Card from '@/components/ui/Card';

export default function LineSetupPage() {
  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">LINE 官方帳號通知設定教學</h1>

      <Card className="mb-6">
        <h2 className="mb-3 font-bold text-ink">一、一次性技術設定（開通 Messaging API）</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-inkMuted">
          <li>
            登入{' '}
            <a className="text-brandDark hover:underline" href="https://manager.line.biz/" target="_blank" rel="noreferrer">
              LINE Official Account Manager
            </a>
            ，選擇要使用的官方帳號
          </li>
          <li>設定（右上角）→ Messaging API → 「啟用 Messaging API」</li>
          <li>選擇既有 Provider 或建立新的（填公司/單位名稱）</li>
          <li>
            開通後會產生一個 Channel，記下畫面上的 <strong className="text-ink">Channel secret</strong>
          </li>
          <li>
            到{' '}
            <a className="text-brandDark hover:underline" href="https://developers.line.biz/" target="_blank" rel="noreferrer">
              LINE Developers
            </a>{' '}
            主控台，找到剛剛建立的 Channel → Messaging API 分頁 → 「Channel access token（長期）」→ 點擊「發行」，複製 token
          </li>
          <li>
            同一頁面記下 Bot 的 <strong className="text-ink">Basic ID</strong>（<code className="rounded bg-background px-1 py-0.5">@xxx</code> 格式）
          </li>
          <li>
            Webhook URL 欄位填入{' '}
            <code className="rounded bg-background px-1 py-0.5">https://hjj-phi.vercel.app/api/line/webhook</code>，並開啟「使用 Webhook」
          </li>
          <li>建議關閉 LINE Official Account Manager 內建的「自動回應訊息」「加入好友歡迎訊息」，避免跟系統自己的回覆邏輯打架</li>
          <li>
            把 Channel access token、Channel secret、Basic ID 分別貼到 Vercel 專案的環境變數：
            <code className="mt-1 block rounded bg-background px-2 py-1">
              LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET / LINE_OA_BASIC_ID
            </code>
            （Basic ID 要連同開頭的 @ 一起貼）
          </li>
        </ol>
      </Card>

      <Card>
        <h2 className="mb-3 font-bold text-ink">二、日常操作：如何幫家長綁定 LINE</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-inkMuted">
          <li>打開「學生名單」，點選要綁定的學生，進入編輯頁</li>
          <li>在「LINE 通知」區塊按「產生綁定 QR code」</li>
          <li>把畫面上的 QR code 給家長看（櫃檯當面出示，或視訊/電話時用手機拍給對方）</li>
          <li>請家長用 LINE 掃描這組 QR code——會直接跳進與官方帳號的對話框，文字已經預填好，請家長直接按送出</li>
          <li>系統收到訊息後會自動完成綁定，並回覆家長「綁定成功」的訊息</li>
          <li>按「重新查詢狀態」確認是否已顯示「已綁定」</li>
          <li>如果家長換手機或封鎖了官方帳號，通知會送不出去，此時到編輯頁按「解除綁定」，再重新走一次上面的流程即可</li>
        </ol>
      </Card>
    </>
  );
}
