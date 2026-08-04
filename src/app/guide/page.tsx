import Link from 'next/link';
import { ReactNode } from 'react';
import Logo from '@/components/ui/Logo';
import ThemeToggle from '@/components/ui/ThemeToggle';

export const metadata = { title: '使用教學 - MUP' };

/* 登入前也能看的靜態使用教學（登入頁有入口，也可直接分享 /guide 連結）。 */

function Shot({ src, alt }: { src: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- 靜態教學截圖，尺寸不一，毋須 next/image 最佳化
  return <img src={`/manual/${src}`} alt={alt} loading="lazy" className="w-full max-w-[280px] rounded-xl border border-borderSubtle shadow-sm" />;
}

function Chapter({ no, title, children }: { no: string; title: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl border border-borderSubtle bg-card p-4">
      <summary className="flex cursor-pointer list-none items-center gap-3 font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-brandInk">
          {no}
        </span>
        <span className="flex-1">{title}</span>
        <span className="ml-2 shrink-0 text-inkMuted transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="mt-4 flex flex-col gap-5 border-t border-borderSubtle pt-4">{children}</div>
    </details>
  );
}

function Step({ no, title, img, imgAlt, children }: { no?: string; title: string; img?: string; imgAlt?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-5">
      <div className="min-w-0 flex-1">
        <p className="mb-1 font-semibold text-ink">
          {no && (
            <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-bold text-brandInk">
              {no}
            </span>
          )}
          {title}
        </p>
        <div className="text-sm leading-relaxed text-inkMuted">{children}</div>
      </div>
      {img && <Shot src={img} alt={imgAlt ?? title} />}
    </div>
  );
}

function Tip({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-borderSubtle bg-stripe p-3 text-sm">
      <p className="font-semibold text-ink">{title}</p>
      <div className="mt-1 text-inkMuted">{children}</div>
    </div>
  );
}

function Dialog({ children }: { children: ReactNode }) {
  return (
    <div className="my-2 rounded-lg border border-borderSubtle bg-stripe p-3 text-sm text-inkMuted">
      <p className="mb-1 text-xs text-inkMuted">畫面會跳出確認視窗</p>
      <p className="text-ink">{children}</p>
    </div>
  );
}

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-cream">
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 pt-6">
        <Logo className="h-8 w-auto" />
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brandInk transition-colors hover:bg-brandDark"
          >
            前往登入
          </Link>
        </div>
      </header>

      <main className="animate-rise-in mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        <div>
          <h1 className="text-xl font-bold text-ink">使用教學</h1>
          <p className="mt-1 text-sm text-inkMuted">
            這裡是學生帳號的完整操作教學：請假、補課、出席查詢、集點卡、弈廳與活動報名。點擊各章節即可展開。
          </p>
        </div>

        <Tip title="開始之前">
          帳號與密碼由教室提供，若尚未取得或忘記密碼，請洽櫃檯行政人員。建議用手機瀏覽器開啟本系統，並可將網址「加入主畫面」，之後像
          App 一樣一點就開。
        </Tip>

        <Chapter no="1" title="登入系統">
          <Step no="1" title="開啟系統網址" img="m01-login-empty.png" imgAlt="登入畫面">
            用瀏覽器開啟系統網址，會看到登入畫面。
          </Step>
          <Step no="2" title="輸入帳號與密碼，按「登入」" img="m02-login-filled.png" imgAlt="輸入帳號密碼後按登入">
            輸入教室提供的帳號與密碼，按下<b className="text-ink">登入</b>（紅框處）。登入成功後會自動進入學生首頁。
          </Step>
          <Step title="小技巧：深夜模式" img="m04-login-dark.png" imgAlt="深夜模式畫面">
            每一頁右上角的<b className="text-ink">月亮圖示</b>可切換深夜模式，晚上看比較不刺眼；再按一次即可切回日間模式。
          </Step>
          <Tip title="忘記密碼？">請聯絡櫃檯行政人員，我們會協助您重設密碼。</Tip>
        </Chapter>

        <Chapter no="2" title="學生首頁導覽">
          <Step no="1" title="票券管理" img="m05-dashboard-top.png" imgAlt="首頁上方：票券管理">
            首頁最上方是<b className="text-ink">票券管理</b>：左邊「課堂」列出就讀班級的上課時間、老師與
            <b className="text-ink">已上堂數／總堂數</b>（附進度條）；右邊「弈廳資格」顯示目前的弈廳票券狀態（詳見第 7
            章）。
          </Step>
          <Step no="2" title="集點卡與常用捷徑" img="m06-dashboard-shortcuts.png" imgAlt="集點卡與功能捷徑">
            <b className="text-ink">我的集點卡</b>顯示目前總點數，點卡片可看明細。下方「請假申請與紀錄」「申請補課」「我的出席紀錄」三張卡片，點了直接前往對應功能，與上方選單相同。
          </Step>
          <Step no="3" title="我的請假與插班紀錄" img="m08-dashboard-leaves.png" imgAlt="請假與插班紀錄表格">
            每一筆請假、對應的插班日期與<b className="text-ink">補課狀態</b>都在這裡。
          </Step>
          <Step no="4" title="弈廳報名紀錄" img="m09-dashboard-gohall.png" imgAlt="弈廳報名紀錄摘要">
            最下方是弈廳場次的報名摘要，點列可前往弈廳頁面。
          </Step>
          <div>
            <p className="mb-2 font-semibold text-ink">頁面上方的導覽列</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- 靜態教學截圖 */}
            <img src="/manual/m10-nav-header.png" alt="上方導覽列" loading="lazy" className="w-full rounded-xl border border-borderSubtle shadow-sm" />
            <p className="mt-2 text-sm text-inkMuted">
              所有功能都在上方選單，<b className="text-ink">選單和表格都可以左右滑動</b>；最右邊的「登出」用於切換帳號或登出系統。
            </p>
          </div>
        </Chapter>

        <Chapter no="3" title="請假申請">
          <Step no="1" title="進入「請假申請」" img="m11-leave-form-empty.png" imgAlt="請假申請頁">
            從上方選單或首頁捷徑進入。上方是請假表單，下方是過去的請假紀錄。
          </Step>
          <Step no="2" title="選班級、選日期、填原因" img="m12-leave-form-filled.png" imgAlt="填好的請假表單">
            依序選擇<b className="text-ink">要請假的班級</b>、<b className="text-ink">請假日期</b>（該班上課日），填寫
            <b className="text-ink">原因</b>，然後按<b className="text-ink">送出請假</b>（紅框處）。
          </Step>
          <Step no="3" title="送出完成，查看紀錄" img="m14-leave-table.png" imgAlt="請假紀錄表格">
            送出後下方「我的請假紀錄」立刻多出這一筆。想幫這次請假安排補課，請看下一章。
          </Step>
        </Chapter>

        <Chapter no="4" title="申請補課（插班／一對一）">
          <div className="text-sm leading-relaxed text-inkMuted">
            補課方式有兩種：<b className="text-ink">插班補課</b>——到同科目的其他班級上一堂課，不限次數，所有科目適用；
            <b className="text-ink">一對一補課</b>——與老師約時段單獨補課，限圍棋課程，每期課程可申請 1 次。
          </div>
          <Step no="1" title="選擇要補課的請假紀錄" img="m15-makeup-select-leave.png" imgAlt="補課須知與選擇請假紀錄">
            進入「補課申請」，頁面上方會先看到教室公告的<b className="text-ink">補課須知</b>，請先讀過一次。接著從步驟
            1 的下拉選單（紅框處）選擇<b className="text-ink">要補課的那一次請假</b>
            。只有還沒申請過補課的請假會出現在這裡。
          </Step>
          <Step no="2" title="插班補課：選班級與日期" img="m16-makeup-insertion-filled.png" imgAlt="插班補課表單">
            選擇要<b className="text-ink">插班的班級</b>（會顯示上課時間與目前人數）與<b className="text-ink">插班日期</b>，按
            <b className="text-ink">送出插班申請</b>（紅框處）。
          </Step>
          <Step no="3" title="一對一補課：選老師與開始時間" img="m18-makeup-oneonone-filled.png" imgAlt="一對一補課表單">
            點選「一對一補課」（會顯示本期剩餘次數），選擇<b className="text-ink">老師</b>後畫面會列出該老師的
            <b className="text-ink">可補課時段</b>，在時段內選日期與<b className="text-ink">開始時間</b>即可——每次一對一固定
            40 分鐘，系統會自動保留到結束時間。按<b className="text-ink">送出一對一申請</b>完成。
          </Step>
          <Step no="4" title="等待行政確認" img="m17-makeup-insertion-success.png" imgAlt="送出後待行政確認">
            送出後會顯示「待行政確認」。教室確認後，首頁的補課狀態會從「待確認」變成「已核准」。
          </Step>
          <div>
            <p className="mb-2 font-semibold text-ink">補課狀態說明</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <tbody>
                  <tr className="border-b border-borderSubtle">
                    <td className="py-2 pr-3"><span className="whitespace-nowrap text-inkMuted">尚未申請</span></td>
                    <td className="py-2 text-inkMuted">這筆請假還沒申請補課。</td>
                  </tr>
                  <tr className="border-b border-borderSubtle">
                    <td className="py-2 pr-3"><span className="whitespace-nowrap rounded-full bg-pendingBg px-2.5 py-0.5 text-xs font-bold text-pending">待確認</span></td>
                    <td className="py-2 text-inkMuted">已送出，等教室行政確認中。</td>
                  </tr>
                  <tr className="border-b border-borderSubtle">
                    <td className="py-2 pr-3"><span className="whitespace-nowrap rounded-full bg-approvedBg px-2.5 py-0.5 text-xs font-bold text-approved">已核准</span></td>
                    <td className="py-2 text-inkMuted">補課確定成立，請準時出席。</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-3"><span className="whitespace-nowrap rounded-full bg-rejectedBg px-2.5 py-0.5 text-xs font-bold text-rejected">已拒絕</span></td>
                    <td className="py-2 text-inkMuted">這次申請未通過（不會用掉一對一額度），可再重新申請。</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <Step no="5" title="臨時不能到？申請撤銷" img="m20-dashboard-cancel-btn.png" imgAlt="申請撤銷按鈕位置">
            已核准的補課若臨時無法出席，到首頁「我的請假與插班紀錄」，按該筆補課下方的<b className="text-ink">申請撤銷</b>
            （紅框處）。
            <Dialog>確定要申請撤銷這筆補課嗎？將由教室行政確認後生效。</Dialog>
            送出後狀態顯示「撤銷申請中」；教室確認前這筆補課仍然有效，確認後即取消，可再重新申請。
          </Step>
        </Chapter>

        <Chapter no="5" title="我的出席紀錄">
          <Step title="查詢出缺勤" img="m22-attendance.png" imgAlt="出席紀錄頁">
            從上方選單進入「我的出席紀錄」，可查看每一次上課的<b className="text-ink">類型</b>
            （班級課、一對一補課、弈廳、活動）、<b className="text-ink">日期、狀態</b>與當天刷卡的
            <b className="text-ink">簽到／簽退時間</b>。
          </Step>
        </Chapter>

        <Chapter no="6" title="集點卡">
          <Step no="1" title="查看點數餘額" img="m23-points-balances.png" imgAlt="集點卡餘額">
            點數分兩種：<b className="text-ink">一般點數</b>由老師加分累積，可抽獎或兌換；
            <b className="text-ink">兌換專用點數</b>是抽獎抽中的，只能兌換獎品。
          </Step>
          <Step no="2" title="查看點數紀錄" img="m24-points-history.png" imgAlt="點數紀錄">
            下方列出每一筆加分、抽獎與兌換：日期、說明、點數增減與加分老師。
          </Step>
          <Tip title="想抽獎或兌換獎品？">請到櫃檯找行政人員登記，點數會即時扣除、獎品當場領取。</Tip>
        </Chapter>

        <Chapter no="7" title="弈廳報名">
          <Step no="1" title="查看弈廳資格" img="m25a-gohall-tickets.png" imgAlt="弈廳資格卡片">
            弈廳頁面最上方顯示您的<b className="text-ink">弈廳資格</b>，共三種狀態：<b className="text-ink">堂票</b>
            ——顯示剩餘堂數，點名到場自動扣 1 堂、缺席不扣；<b className="text-ink">季票使用中</b>
            ——顯示有效期限，期間內到場不扣堂票；<b className="text-ink">單堂計費</b>——尚未購票，到場現場收費。購票請洽櫃檯。
          </Step>
          <Step no="2" title="挑選場次，按「報名」" img="m25-gohall-list.png" imgAlt="弈廳場次列表">
            「開放中的場次」列出日期、時間、老師與<b className="text-ink">剩餘名額</b>。找到想參加的場次按
            <b className="text-ink">報名</b>（紅框處）。點場次那一列還可以看目前的報名名單。
            <Dialog>確定要報名這場嗎？</Dialog>
          </Step>
          <Step no="3" title="報名完成／取消報名" img="m26-gohall-registered.png" imgAlt="我的報名紀錄">
            報名成功後，場次會出現在下方「我的報名紀錄」；行程有變按該列的<b className="text-ink">取消</b>即可，名額會釋出。
          </Step>
        </Chapter>

        <Chapter no="8" title="活動專區">
          <Step no="1" title="瀏覽活動列表" img="m27-activities-list.png" imgAlt="活動列表">
            教室舉辦的營隊、比賽、講座都在「活動專區」。列表顯示封面、分類、日期、地點與剩餘名額，
            <b className="text-ink">點任一列</b>可打開活動詳情。
          </Step>
          <Step no="2" title="查看詳情，按「報名」" img="m29-activity-register-btn.png" imgAlt="活動詳情與報名按鈕">
            詳情視窗有完整活動說明、報名名單與<b className="text-ink">活動相簿</b>
            （活動結束後教室會上傳照片）。確定參加就按右下角的<b className="text-ink">報名</b>。
            <Dialog>確定要報名這個活動嗎？</Dialog>
          </Step>
          <Step no="3" title="報名完成／取消報名" img="m30-activity-registered.png" imgAlt="活動報名紀錄">
            報名後活動會出現在「我的報名紀錄」。再點開活動詳情，右下角會變成<b className="text-ink">取消報名</b>。
          </Step>
        </Chapter>

        <Tip title="還有問題？">
          登入後可到上方選單的「常見問題」查看更多說明；任何操作或帳號問題，都歡迎聯絡櫃檯行政人員。
        </Tip>

        <div className="pb-6 text-center">
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-lg bg-brand px-6 py-2.5 text-sm font-semibold text-brandInk transition-colors hover:bg-brandDark"
          >
            我了解了，前往登入
          </Link>
        </div>
      </main>
    </div>
  );
}
