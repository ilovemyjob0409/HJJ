# 活動相簿（Activity Album）— Design

## Problem

活動專區目前只有文字資訊。使用者需要一個能替每個活動維護多張照片的地方
（例如活動花絮、海報），行政人員上傳管理，全部登入者瀏覽。

## Scope

**In scope:**
- 每個活動一本相簿（多張照片），依上傳時間排序。
- 上傳/刪除：僅 ADMIN。瀏覽：所有登入角色（ADMIN/TEACHER/STUDENT）。
- 照片存 Supabase Storage 私有 bucket `activity-images`（已建立：
  private、10MB/檔、jpeg/png/webp）。瀏覽一律走伺服器簽發的限時簽名
  網址（1 小時），未登入者拿不到網址，外流連結一小時後失效。
- 瀏覽器端上傳前自動壓縮（最長邊 2000px、JPEG 0.85）。
- 刪除活動時連同照片（DB 紀錄 + Storage 檔案）一併刪除。
- 動效沿用現有系統（Button loading、skeleton-shimmer、animate-fade-in）。

**Out of scope（YAGNI）:**
- 手動排序、照片說明文字、封面指定、相簿以外的顯示位置（列表縮圖）。
- 老師/學生上傳。
- 圖片 CDN 轉檔/多尺寸縮圖（簽名網址直出原檔——已壓縮過，夠用）。
- HEIC 轉檔（iOS 相簿選取時系統會自動轉 JPEG）。

## Data layer

```prisma
model ActivityImage {
  id          String   @id @default(cuid())
  activityId  String
  activity    Activity @relation(fields: [activityId], references: [id])
  storagePath String   // e.g. "<activityId>/<cuid>.jpg" — bucket 內路徑
  createdAt   DateTime @default(now())
}
// Activity 增加反向關聯 images ActivityImage[]
```

以 `prisma db push` 佈署（本專案慣例，無 migrations 資料夾）。

## Storage client

新檔 `src/lib/storage.ts`：以 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
建立 server-side Supabase client（`@supabase/supabase-js`，新增依賴，僅
server 端 import）。提供：

- `uploadActivityImage(activityId, buffer, contentType): Promise<storagePath>`
- `createSignedUrls(paths: string[]): Promise<Record<path, url>>`（batch，1h 效期）
- `deleteActivityImages(paths: string[])`

環境變數缺失時 throw 明確錯誤（部署防呆）。金鑰絕不進前端 bundle
（無 `NEXT_PUBLIC_` 前綴即保證）。

## API

- `GET /api/activities/[id]/images` — 任何登入者。回
  `[{ id, url(簽名網址), createdAt }]`，依 createdAt asc。
- `POST /api/activities/[id]/images` — 僅 ADMIN。`multipart/form-data`
  單檔欄位 `file`；驗證 content-type ∈ {jpeg,png,webp} 且 ≤ 4MB
  （壓縮後遠低於此）；存 Storage → 寫 DB → 回新紀錄（含簽名網址）。
  多檔由前端逐檔呼叫（簡化 API 與錯誤處理）。
- `DELETE /api/activity-images/[imageId]` — 僅 ADMIN。刪 Storage 檔案
  + DB 紀錄（先刪 DB 後刪 Storage；Storage 刪除失敗不回滾 DB——孤兒
  檔案無妨，反向則會出現破圖）。
- `deleteActivity` service 擴充：一併刪除該活動全部照片（Storage+DB）。

## Frontend

**共用元件 `src/components/ActivityAlbum.tsx`：**
- props: `activityId`、`canManage: boolean`。
- 載入 GET images：期間顯示 3 格 `skeleton-shimmer` 佔位；完成後縮圖
  grid（`grid-cols-3`，`animate-fade-in`）。
- 空相簿時：canManage=true 顯示「尚無照片」+ 上傳按鈕；
  canManage=false 顯示「尚無照片」文字即可。
- 縮圖 `<img>` 用簽名網址；點擊 `window.open(url)` 開新分頁。
- `canManage` 時：上方「＋ 上傳照片」`<Button loading>`（`<input
  type="file" multiple accept="image/jpeg,image/png,image/webp">`），
  逐檔壓縮（canvas：最長邊 2000px、`toBlob('image/jpeg', 0.85)`；
  png/webp 同樣重新編碼為 JPEG）後逐檔 POST，全部完成後 reload 清單
  + toast；每張縮圖右上角 ✕ 刪除（`confirm()` 後 DELETE，per-row
  pendingId 模式）。

**接入點（三個角色的活動詳情 Modal）：**
- `admin/activities` 詳情 Modal：`<ActivityAlbum activityId canManage />`
- `student/activities`、`teacher/activities` 詳情 Modal：
  `<ActivityAlbum activityId canManage={false} />`

## Error handling

- 上傳：任一檔失敗 → toast 顯示第幾張失敗，已成功的保留；按鈕
  try/finally 恢復。
- 簽名網址過期（開著頁面超過 1 小時後點縮圖）：點擊時網址已含於
  props——接受此限制（重新整理即可），不做自動續簽（YAGNI）。
- GET/POST 對不存在的 activityId：404。

## Testing

- service 層（storage.ts 的 DB 部分與 deleteActivity 級聯）：vitest
  單元測試，Storage client 以注入/mock 隔離（不打真網路）。
- API 權限矩陣（ADMIN/TEACHER/STUDENT × GET/POST/DELETE）：vitest。
- 瀏覽器實測：上傳（大圖壓縮）、刪除、三角色瀏覽、簽名網址未登入
  直開 bucket 路徑應 400/403、深淺色主題、Safari。
