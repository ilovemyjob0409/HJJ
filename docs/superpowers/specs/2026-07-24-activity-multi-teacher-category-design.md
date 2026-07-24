# 活動專區 — 帶領老師複選 / 分類可維護 — Design

## Problem

活動專區（Activity Zone）剛上線時，「帶領老師」是單選且選填，「分類」是四個固定寫死的選項（營隊/講座/比賽/觀摩課）。實際使用後發現兩個限制：

1. 一個活動常常需要多位老師共同帶領，單選無法表達。
2. 固定分類選項不夠用，管理員需要能自行新增/刪除/調整分類，而不是每次都要改程式碼。

這份 spec 涵蓋這兩個變動。目前正式環境還沒有任何 `Activity` 資料（0 筆），所以不需要處理既有資料的搬遷。

## Scope

**In scope:**
- 「帶領老師」從單選、選填，改成複選、**至少 1 位**（不再允許 0 位老師）。
- 「分類」從固定 enum 改成管理員可自訂的清單：可新增、刪除、（透過刪除+新增達成）改名；清單維護介面直接整合在 `/admin/activities` 頁面上。
- 分類刪除保護：仍有活動使用中的分類不能刪除。
- 三個角色頁面（管理員/老師/學生）顯示多位老師姓名、顯示自訂分類名稱。

**Out of scope（沿用原 spec 的既有限制，不在這次變動）：**
- 活動本身仍然沒有編輯功能（只能新增/刪除）。
- 分類沒有「編輯名稱」的 API/UI，改名做法是刪除舊的、新增新的（因為目前沒有活動在用分類，這個限制影響很小；如果未來需要直接改名，屬於另一個獨立需求）。
- 不做分類排序、分類顏色、分類圖示等視覺客製化。
- 老師複選不影響老師頁面既有的唯讀權限（多位老師都只能唯讀查看，不能互相移除彼此或刪除活動）。

## Data layer

```prisma
model ActivityCategory {
  id         String     @id @default(cuid())
  name       String     @unique
  createdAt  DateTime   @default(now())
  activities Activity[]
}

model ActivityTeacher {
  id         String   @id @default(cuid())
  activityId String
  activity   Activity @relation(fields: [activityId], references: [id])
  teacherId  String
  teacher    Teacher  @relation(fields: [teacherId], references: [id])

  @@unique([activityId, teacherId])
}

model Activity {
  id            String                  @id @default(cuid())
  title         String
  description   String
  categoryId    String
  category      ActivityCategory        @relation(fields: [categoryId], references: [id])
  location      String?
  startDate     DateTime
  endDate       DateTime
  capacity      Int
  teachers      ActivityTeacher[]
  registrations ActivityRegistration[]
  createdAt     DateTime                @default(now())
}
```

變動：
- 移除 `enum ActivityCategory`，改成 `model ActivityCategory`（沿用同一個名字，因為 enum 拿掉後名字空出來了）。
- 移除 `Activity.teacherId`（單一、選填）欄位與其 `teacher` 關聯，改成透過 `ActivityTeacher` 關聯表表達多對多，`@@unique([activityId, teacherId])` 防止同一位老師被重複指派到同一個活動。
- `Activity.categoryId` 必填（跟原本「一定要選一個分類」的行為一致）。
- `Teacher` model 的反向關聯欄位從 `activities Activity[]` 改成 `activityTeachers ActivityTeacher[]`。

**初始資料：** schema 套用後，直接建立 4 筆 `ActivityCategory`：營隊、講座、比賽、觀摩課（對應原本 enum 的四個值），管理員之後可以自行新增/刪除。因為目前 0 筆 `Activity`，不需要任何資料搬遷腳本。

## Service layer

`src/lib/services/activityService.ts` 變動：

- `CreateActivityInput` 改成 `{ title, description, categoryId, location?, startDate, endDate, capacity, teacherIds }`（`teacherIds: string[]`，長度需 ≥ 1，由呼叫端 API 層驗證）。
- `createActivity(input)`：用巢狀寫法一次建立活動與老師關聯：
  ```ts
  prisma.activity.create({
    data: {
      ...,
      categoryId: input.categoryId,
      teachers: { create: input.teacherIds.map((teacherId) => ({ teacherId })) },
    },
  });
  ```
- `listAllActivities` / `listActivitiesForTeacher` / `listOpenActivitiesForStudent` / `getActivityDetail` 的 select 都加上：
  ```ts
  category: { select: { name: true } },
  teachers: { select: { teacher: { select: { user: { select: NAME_ONLY_SELECT } } } } },
  ```
- `listActivitiesForTeacher(teacherId)`：篩選條件從 `where: { teacherId }` 改成 `where: { teachers: { some: { teacherId } } }`。
- `deleteActivity(id)`：交易內依序刪除 `activityRegistration` → `activityTeacher` → `activity`（維持現有「不用 `onDelete: Cascade`，程式明確刪」的風格）。

新增分類管理函式：

```ts
export function listCategories() {
  return prisma.activityCategory.findMany({ orderBy: { name: 'asc' } });
}

export function createCategory(name: string) {
  return prisma.activityCategory.create({ data: { name } });
}

export async function deleteCategory(id: string) {
  const count = await prisma.activity.count({ where: { categoryId: id } });
  if (count > 0) throw new Error('CATEGORY_IN_USE');
  await prisma.activityCategory.delete({ where: { id } });
}
```

`createCategory` 不特別捕捉唯一性衝突（P2002）——維持這個 codebase 既有的慣例（例如 `teacherService.createTeacher`／`studentService.createStudent` 也是讓 P2002 往上拋，由 API 路由層 catch）。

## API layer

- `POST /api/activities`：body 改成 `{ title, description, categoryId, location, startDate, endDate, capacity, teacherIds }`。若 `teacherIds` 缺漏或為空陣列，回 400。
- 新增 `src/app/api/activity-categories/route.ts`：
  - `GET`：ADMIN-only，回傳 `listCategories()`。
  - `POST`：ADMIN-only，body `{ name }`；catch P2002 回 409 `{ error: 'CATEGORY_NAME_TAKEN' }`（比照 `src/app/api/teachers/route.ts` 現有的 `EMAIL_TAKEN` 寫法）。
- 新增 `src/app/api/activity-categories/[id]/route.ts`：
  - `DELETE`：ADMIN-only；catch `CATEGORY_IN_USE` 回 409。
- 其餘既有路由（`/api/activities/[id]`、`/api/activity-registrations`、`/api/activity-registrations/[id]`）邏輯不變，只是底層回傳的活動物件多了 `category`、`teachers` 欄位。

## UI layer

**管理員 — `/admin/activities`：**
- 新增活動表單：
  - 「分類」下拉選單資料來源改成 `GET /api/activity-categories`（原本寫死的 4 個 `<option>` 移除）。
  - 「帶領老師」從單選 `<Select>` 改成複選 checkbox 清單，UI 樣式沿用 `/admin/students` 建立表單裡「所屬班級（可複選）」那組（可捲動框 + checkbox list），至少要勾 1 位才能送出（`required` 邏輯用前端擋，送出時若 0 位就不 submit 並顯示錯誤文字）。
  - 表單下方新增一個「管理分類」收合面板（與「新增活動」同樣的收合樣式）：
    - 分類清單，每筆顯示名稱 + 「刪除」按鈕。
    - 清單下方一個小表單：文字輸入框 + 「新增分類」按鈕。
    - 刪除回傳 409 `CATEGORY_IN_USE` 時，用 toast 顯示「此分類仍有活動使用中，請先處理」，不用 confirm dialog（後端本來就會擋，不需要前端二次確認）。
- 活動列表表格：「分類」欄位顯示 `a.category.name`；「老師」欄位顯示 `a.teachers.map(t => t.teacher.user.name).join('、')`。
- 名單彈窗：老師資訊同樣顯示多位老師、頓號連接。

**老師 — `/teacher/activities`：**
- 列表與名單彈窗顯示分類名稱（`category.name`）與所有帶領老師（`teachers[].teacher.user.name`，頓號連接）——包含老師自己在內的所有共同負責人，方便老師知道還有誰一起帶。操作權限不變（唯讀，無刪除/移除按鈕）。

**學生 — `/student/activities`：**
- 「活動列表」與「我的報名紀錄」的分類、老師欄位比照上述方式顯示。
- 名單彈窗（`GET /api/activities/[id]`）的老師顯示邏輯不變，姓名遮蔽邏輯（`maskName`）不受影響。

**Nav：** 不變動，`/admin/activities`、`/teacher/activities`、`/student/activities` 路徑與現有 nav entry 都維持原樣。

## Error handling

- `POST /api/activities`：`teacherIds` 空陣列或缺漏 → 400。
- `POST /api/activity-categories`：分類名稱重複 → 409 `CATEGORY_NAME_TAKEN`。
- `DELETE /api/activity-categories/[id]`：分類使用中 → 409 `CATEGORY_IN_USE`。
- 既有錯誤（`ACTIVITY_FULL`、`NOT_OWNER`）不變。

## Testing

- `createActivity`：用 `categoryId` + 多個 `teacherIds` 建立，`listAllActivities` 驗證回傳的 `category.name` 與 `teachers[]`（陣列內容、對應老師姓名）正確。
- `listActivitiesForTeacher`：一個活動指派兩位老師，分別用這兩位老師的 id 查詢都要查到該活動；第三位沒被指派的老師查不到。
- `listCategories` / `createCategory` / `deleteCategory`：
  - 新增分類後能在 `listCategories()` 查到，依名稱排序。
  - 分類被活動使用中時呼叫 `deleteCategory` 拋出 `CATEGORY_IN_USE`。
  - 分類沒被使用時 `deleteCategory` 成功、資料表中該筆消失。
  - 名稱重複時 `createCategory` 讓 Prisma P2002 往上拋（由 API 層測試/驗證轉譯，service 層測試只需確認錯誤有拋出）。
- `deleteActivity`：確認刪除後 `ActivityTeacher` 關聯列一併清除、無孤兒資料（沿用現有 registrations 孤兒檢查測試的寫法，多加一個 `activityTeacher` 計數檢查）。
