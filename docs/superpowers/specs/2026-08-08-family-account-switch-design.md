# 手足帳號快速切換

## 背景與目標

家長反應：一個家庭有多個小孩，每個小孩各自有獨立帳號（`User.email` 要求唯一，就算帳號欄位填的是手機號碼，同一支手機號碼也不能給兩個小孩共用），家長要幫兩個小孩處理請假、補課等事務時，必須不斷登出、登入切換帳號。

目標：家長用其中一個小孩的帳號密碼登入後，能在畫面上直接切換成另一個手足的身份操作（請假、補課、預約個別輔導等），**不用再輸入第二個小孩的密碼**。

**核心決策**（brainstorming 過程中已確認）：
1. 維持現有「一個帳號一個學生」架構，不做「家長帳號＋底下掛多個小孩」的全新帳號類型——只加「快速切換」能力，改動範圍最小。
2. 手足關聯由**行政後台手動綁定**，不做「依家長電話自動判斷」（`parentPhone` 是自由文字欄位，容易打錯字，拿來當信任依據不夠可靠）。
3. 切換後送出的請假／補課紀錄**不用**額外標記「這是從哪個手足帳號切換過去操作的」——維持現狀正常送出即可。
4. 切換按鈕放在**頁首右上角**（跟「登出」並排），不做獨立橫幅。

## 範圍

**這次改的**：
- `Student` 新增 `familyGroupId` 欄位。
- 新增一支換身份用的 API（核發限時單次權杖）。
- `authorize()`（NextAuth credentials provider）新增「用權杖登入」分支。
- `AppShell` 頁首新增手足切換下拉選單（僅 STUDENT 角色、且 `familyGroupId` 不為 null 時顯示）。
- 「學生名單」後台頁面新增「設定手足」功能。

**不改的**：其他所有頁面／API 讀取「目前登入使用者是哪個學生」的邏輯完全不變（因為切換的本質是換掉整個 session 的身份，不是加一個「代操作對象」參數）。密碼登入路徑不變。

## 資料層

`prisma/schema.prisma` 的 `Student` model 新增一個可為空欄位：

```prisma
model Student {
  // ...既有欄位
  familyGroupId String?   // null = 沒有手足；同一組手足共用同一個值
}
```

不建額外的關聯表或 join table。「手足」的定義就是「`familyGroupId` 相同且不為 null 的所有 `Student`」，用一個欄位就能表達，也自然支援兩個以上的小孩（不限手足數量為 2）。查詢範例：

```ts
prisma.student.findMany({ where: { familyGroupId, id: { not: currentStudentId } } })
```

`familyGroupId` 的值本身沒有語意，新建群組時用 `cuid()` 產生即可（沿用專案既有 id 產生慣例）。

## 後端：切換權杖 API

新增 `POST /api/auth/family-switch-token`：

1. 驗證目前 session 存在、角色是 `STUDENT`。
2. 查目前登入者對應的 `Student.familyGroupId`；若為 null，回 403（沒有手足，不能切換）。
3. 查 body 帶的 `targetStudentId` 對應的 `Student`；若不存在，或其 `familyGroupId` 跟目前登入者不同，回 403。
4. 核發一個**短效期（30 秒）、單次使用**的權杖，內容綁定目標學生的 `userId`。實作方式：一個獨立的 `SwitchToken` 資料表（`token`、`targetUserId`、`expiresAt`、`usedAt`），或等效的簽章 token（例如用 `jsonwebtoken` 簽一個帶 `exp` 的短效 JWT，驗證時額外查一張「已使用 token」表擋重放）。兩種都可以，**建議用資料表**（比較好在測試裡直接斷言「用過的 token 第二次會失敗」，不用處理 JWT 簽章細節）。
5. 回傳 `{ switchToken }`。

新增資料表：

```prisma
model FamilySwitchToken {
  id           String   @id @default(cuid())
  token        String   @unique
  targetUserId String
  expiresAt    DateTime
  usedAt       DateTime?
}
```

## 後端：NextAuth 擴充

`src/lib/auth.ts` 的 `CredentialsProvider.authorize()` 新增一個分支：

```ts
async authorize(credentials) {
  if (credentials?.switchToken) {
    const record = await prisma.familySwitchToken.findUnique({ where: { token: credentials.switchToken } });
    if (!record || record.usedAt || record.expiresAt < new Date()) return null;
    await prisma.familySwitchToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: record.targetUserId } });
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  }
  // 既有 email/password 分支不變
}
```

`credentials` 設定物件的宣告也要補上 `switchToken: { label: 'Switch Token', type: 'text' }`（可選欄位，跟 `email`/`password` 並存，前端呼叫 `signIn` 時二選一帶）。

## 前端：學生端切換 UI

`AppShell.tsx`：
- 進入頁面時（僅 `role === 'STUDENT'`）打一支新的 `GET /api/students/me/siblings`，回傳目前登入者的手足列表（`[]` 代表沒有手足，此時完全不顯示切換按鈕）。
- 有手足時，頁首「登出」按鈕左邊加一個 `👤 {目前姓名} ▾` 的按鈕，點開顯示手足清單（含自己，標示「目前」）。
- 點某個手足姓名 → 呼叫 `POST /api/auth/family-switch-token` 拿到 `switchToken` → 呼叫 `signIn('credentials', { switchToken, redirect: true, callbackUrl: '/student' })`。
- 沿用既有 `Card`／下拉選單的視覺樣式（與「學生首頁」個別輔導報名切換按鈕、guide 的 `Chapter` 下拉樣式一致的圓角＋陰影），不另創新樣式。

## 後端＋前端：後台設定手足

「學生名單」（`src/app/admin/students/page.tsx`）每一列新增「設定手足」按鈕，開一個 `Modal`：
- 列出全校學生（可搜尋），複選框讓行政勾選要跟這個學生歸為手足的其他學生。
- 存檔邏輯（依序判斷）：
  1. 目前學生自己已有 `familyGroupId` → 沿用它，把所有勾選的學生都改成這個值。
  2. 目前學生沒有，但勾選的學生裡有人已經有 `familyGroupId` → 取**第一個**有值的當作目標 group id，目前學生跟其餘所有勾選的學生都改成這個值。
  3. 目前學生跟所有勾選的學生都還沒有 `familyGroupId` → 新建一個 group id，全部指派上去。
  - 三種情況都是「全部併入同一個 group id」，不處理拆分邏輯——要解除手足關係就把某人從勾選中移除重新存檔，該學生的 `familyGroupId` 設回 null。
  - 這代表勾選的學生們原本若分屬兩個不同的既有群組，存檔後會直接合併成一個——這是預期行為，不彈警告或阻擋（維持 UI 簡單，行政本來就是刻意選了這些人要當手足）。
- 新增 API：`PATCH /api/students/[id]/family` 接受 `{ siblingIds: string[] }`，做上述合併/指派邏輯，僅 ADMIN 可呼叫。

## 安全性考量

- 換身份權杖**必須**驗證雙方 `familyGroupId` 相同，不能只信任前端傳來的 `targetStudentId`——這是整個功能唯一的信任邊界，其餘頁面完全不用改，所以這一步的驗證要在測試裡重點覆蓋。
- 權杖限時 30 秒、單次使用，即使被瀏覽器紀錄或網路攔截也很快失效。
- 权杖核發 API 本身要求「目前 session 已登入且是 STUDENT」，不能匿名呼叫。
- 不做「登入頁直接輸入手機號碼免密碼登入」這種全新的登入方式（使用者已確認登入起點仍是既有帳密）。

## 邊界情況

- 學生沒有手足（`familyGroupId` 為 null）：頁首不顯示切換按鈕，`family-switch-token` API 直接 403。
- 權杖過期或已使用：`signIn` 會失敗（等同密碼錯誤），前端顯示既有的「帳號或密碼錯誤」提示文字即可，不用另外設計錯誤訊息。
- 行政把某學生從手足群組移除後，該學生自己以及原本手足都不能再切換到/切換自它。
- 一個家庭 3 個以上小孩：`familyGroupId` 天然支援，下拉選單列出所有同組學生即可，不限兩個。

## 測試計畫

- `familyGroupId` 合併/指派邏輯（`PATCH /api/students/[id]/family` 背後的 service 函式）：新建群組、併入既有群組、移除手足（設回 null）三種情境。
- `family-switch-token` API：手足關係成立才核發、`familyGroupId` 為 null 時 403、目標學生不同組時 403、非 STUDENT 角色呼叫時 403。
- `authorize()` 的權杖分支：有效權杖登入成功、過期權杖失敗、已使用過的權杖第二次失敗、權杖與既有 email/password 分支互不影響（既有密碼登入測試維持全過）。
- 前端切換 UI：沒有手足時不顯示按鈕；瀏覽器手動驗證切換後頁面身份確實改變（延續本專案「service 層寫自動化測試、前端互動用瀏覽器手動驗證」的既有慣例）。

## 不在這次範圍內

- 家長專屬的全新登入方式（用手機號碼或其他管道直接登入，不經過任何一個小孩的既有帳密）。
- 切換操作的稽核紀錄（使用者已明確表示不需要標記操作是從哪個手足切換過去送出的）。
- 後台「一次查看某家庭底下所有小孩總覽」這類管理報表功能。
