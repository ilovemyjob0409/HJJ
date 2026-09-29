# 多教室 第一階段：教室隔離 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 MUP 改成多租戶。所有資料都屬於某一間「教室」，登入改成「教室代碼 → 帳號 → 密碼」，現有資料全部搬進教室 `hjjdaya`，任何教室都讀不到、也改不到別間教室的資料。

**Architecture:** 
- 新增 `Classroom` 表。現有 48 個 model 全部加上 `classroomId`（DB 預設值為 `current_setting('app.classroom_id')`），並把所有租戶之間的關聯改成複合外鍵 `(classroomId, xId) → (classroomId, id)`。
- 讀寫隔離由 Prisma `$extends` 統一過濾器處理：用 AsyncLocalStorage 保存明確範圍；沒有明確範圍時，改從當次請求的 session 取得教室。
- 跨教室關聯由資料庫的複合外鍵擋下。

**Tech Stack:** Next.js 14.2 App Router、next-auth 4.24（JWT）、Prisma 7.8（`@prisma/adapter-pg`）、PostgreSQL（Supabase）、Vitest 4。

**Spec:** `docs/superpowers/specs/2026-09-29-multi-classroom-design.md`（第一階段）

## Global Constraints

- 教室代碼規則：只能用 a–z、0–9、`-`；不能以 `-` 開頭或結尾，也不能連續兩個 `-`；長度 3–20；比對不分大小寫（先 trim 再轉小寫）。保留字不能用：`admin`、`platform`、`api`、`www`、`login`、`logout`、`mup`、`test`、`static`、`public`。
- 作者教室：id `cls_hjjdaya`，代碼 `hjjdaya`，名稱 `黑嘉嘉圍棋 大雅分校`（第二階段起可以改名）。
- 登入失敗的訊息一律是「教室代碼、帳號或密碼錯誤」。教室停用時，要在帳密正確之後才顯示「此教室已停用，請聯絡平台管理員」。
- 登入頁用 `/login?c=<代碼>` 預填代碼；localStorage key 用 `mup.lastClassroomCode`，所有讀寫都要包 try/catch。
- 租戶查詢一律 **fail-closed**：沒有教室範圍就拋出 `NO_CLASSROOM_CONTEXT`，不准回傳全部資料。
- 只有兩個例外入口可以繞過自動範圍：`withClassroom(id, fn)` 與 `asPlatform(fn)`。每一處使用都要在程式碼旁註解原因。
- 唯一不改成複合外鍵的關聯：`GoHallTicketTransaction.session`（`onDelete: SetNull`，改成複合外鍵會把 classroomId 一起設成 null）。
- 租戶 model 的寫入不准用 checked relation 寫法（`connect`、`connectOrCreate`）。一律寫純量 FK id；巢狀 `create` 必須明確帶 `classroomId`。
- 日期一律 UTC 日曆日；顯示日期用 `formatDateWithWeekday`；表單用共用 `Input`／`Select` 元件；錯誤碼格式 `^[A-Z_]+$`，不准外洩 Prisma 原始錯誤訊息。
- 測試：`npx vitest run <file>`；全套 `npm test`。worktree 要用專用測試 DB，不准推到共用的 `tutoring_makeup_system_test`。
- commit 只 add 明確列出的檔案，不准 `git add -A`；不准 commit `.superpowers/`、`.impeccable/`。

## File Structure

- Create `src/lib/classroomCode.ts`：代碼的正規化與驗證（純函式）
- Create `src/lib/sessionCookie.ts`：session cookie 名稱（middleware 在 edge 執行，也要能 import）
- Create `src/lib/tenant.ts`：AsyncLocalStorage 範圍、`withClassroom`／`asPlatform`／`resolveScope`／`currentClassroomId`、測試用的預設教室
- Modify `src/lib/db.ts`：加上租戶過濾擴充
- Create `scripts/tenantize-schema.py`：一次性的 schema 改寫腳本（commit 進 repo，作為紀錄）
- Modify `prisma/schema.prisma`：由腳本改寫，另外手動處理 BillingSetting
- Create `src/lib/testUtils/classroom.ts`：測試用教室
- Modify `vitest.setup.ts`：每個測試前建立預設教室
- Create `src/lib/tenantSchema.test.ts`：結構守門測試
- Create `src/lib/tenant.test.ts`、`src/lib/classroomCode.test.ts`、`src/lib/tenantIsolation.test.ts`
- Create `src/lib/services/classroomService.ts`（+ test）：依代碼找教室、列出啟用中的教室、逐教室執行
- Create `src/lib/services/authService.ts`（+ test）：帳密驗證
- Modify `src/lib/auth.ts`、`src/types/next-auth.d.ts`、`src/middleware.ts`、`src/app/login/page.tsx`
- Modify `src/lib/services/familyService.ts`（`redeemSwitchToken`）
- Modify：`closedDayService`、`subjectColorService`、`billingSettingService`、`attendanceService`（學號查詢）、`classService`（巢狀 create 與 raw SQL）、`billingBatchService`（raw SQL）、`billEditService`（raw SQL）、`storage.ts`、`deferBestEffort.ts`、兩支 cron route、`prisma/seed.ts`、`prisma/create-admin.ts`
- Create `docs/superpowers/2026-09-29-multi-classroom-production.sql`、`docs/superpowers/2026-09-29-multi-classroom-rollout.md`、`scripts/perf-compare.ts`

---

### Task 1: 教室代碼工具與租戶範圍模組

**Files:**
- Create: `src/lib/classroomCode.ts`, `src/lib/classroomCode.test.ts`
- Create: `src/lib/sessionCookie.ts`
- Create: `src/lib/tenant.ts`, `src/lib/tenant.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // classroomCode.ts
  export const RESERVED_CLASSROOM_CODES: readonly string[]
  export function normalizeClassroomCode(raw: string): string
  export function validateClassroomCode(code: string): { ok: true } | { ok: false; reason: 'FORMAT' | 'RESERVED' }
  // sessionCookie.ts
  export const SESSION_COOKIE_NAME: string
  export const USE_SECURE_COOKIES: boolean
  // tenant.ts
  export type TenantScope = { kind: 'classroom'; classroomId: string } | { kind: 'platform' }
  export function withClassroom<T>(classroomId: string, fn: () => Promise<T>): Promise<T>
  export function asPlatform<T>(fn: () => Promise<T>): Promise<T>
  export function resolveScope(): Promise<TenantScope>        // 找不到範圍時丟 NO_CLASSROOM_CONTEXT
  export function currentClassroomId(): Promise<string>       // 平台範圍時丟 PLATFORM_SCOPE_HAS_NO_CLASSROOM
  export function setTestDefaultClassroom(id: string | null): void  // 只有 VITEST 能呼叫
  ```

- [ ] **Step 1: 寫失敗的測試** `src/lib/classroomCode.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { normalizeClassroomCode, validateClassroomCode } from './classroomCode';

describe('classroomCode', () => {
  it('trim＋轉小寫', () => {
    expect(normalizeClassroomCode('  HJJDAYA ')).toBe('hjjdaya');
  });
  it('合法代碼', () => {
    for (const c of ['hjj', 'hjjdaya', 'abc-english', 'a1b', 'x'.repeat(20)]) expect(validateClassroomCode(c)).toEqual({ ok: true });
  });
  it('格式錯誤', () => {
    for (const c of ['ab', 'x'.repeat(21), '-abc', 'abc-', 'a--b', 'Abc', 'a_b', 'a b', '中文班']) {
      expect(validateClassroomCode(c)).toEqual({ ok: false, reason: 'FORMAT' });
    }
  });
  it('保留字', () => {
    for (const c of ['admin', 'platform', 'api', 'www', 'login', 'logout', 'mup', 'test', 'static', 'public']) {
      expect(validateClassroomCode(c)).toEqual({ ok: false, reason: 'RESERVED' });
    }
  });
});
```

`src/lib/tenant.test.ts`：

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { withClassroom, asPlatform, resolveScope, currentClassroomId, setTestDefaultClassroom } from './tenant';

describe('tenant scope', () => {
  afterEach(() => setTestDefaultClassroom('restored-by-vitest-setup'));

  it('withClassroom 內可取得教室', async () => {
    expect(await withClassroom('c1', () => currentClassroomId())).toBe('c1');
  });
  it('巢狀範圍以最內層為準，離開後恢復', async () => {
    await withClassroom('outer', async () => {
      expect(await withClassroom('inner', () => currentClassroomId())).toBe('inner');
      expect(await currentClassroomId()).toBe('outer');
    });
  });
  it('跨 await 仍保留範圍', async () => {
    const id = await withClassroom('c2', async () => {
      await new Promise((r) => setTimeout(r, 5));
      return currentClassroomId();
    });
    expect(id).toBe('c2');
  });
  it('asPlatform 範圍沒有教室', async () => {
    expect(await asPlatform(() => resolveScope())).toEqual({ kind: 'platform' });
    await expect(asPlatform(() => currentClassroomId())).rejects.toThrow('PLATFORM_SCOPE_HAS_NO_CLASSROOM');
  });
  it('沒有明確範圍時用測試預設教室；清掉之後 fail-closed', async () => {
    setTestDefaultClassroom('dflt');
    expect(await currentClassroomId()).toBe('dflt');
    setTestDefaultClassroom(null);
    await expect(resolveScope()).rejects.toThrow('NO_CLASSROOM_CONTEXT');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/classroomCode.test.ts src/lib/tenant.test.ts`
Expected: FAIL（找不到模組）

- [ ] **Step 3: 實作**

`src/lib/classroomCode.ts`：

```ts
// 教室代碼：登入時用來「選教室」的英文簡稱（不是密碼）。規則同時符合 DNS 子網域
// 格式，將來改成 <代碼>.<網域> 時可以直接沿用。
export const RESERVED_CLASSROOM_CODES = ['admin', 'platform', 'api', 'www', 'login', 'logout', 'mup', 'test', 'static', 'public'] as const;

const CODE_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,19}$/;

export function normalizeClassroomCode(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateClassroomCode(code: string): { ok: true } | { ok: false; reason: 'FORMAT' | 'RESERVED' } {
  if (!CODE_PATTERN.test(code)) return { ok: false, reason: 'FORMAT' };
  if ((RESERVED_CLASSROOM_CODES as readonly string[]).includes(code)) return { ok: false, reason: 'RESERVED' };
  return { ok: true };
}
```

（這個 pattern 的意思：第一個字元是英數；後面 2～19 個字元，每個要嘛是英數，要嘛是後面緊接英數的 `-`。這樣可以排除結尾 `-` 和 `--`，總長度 3–20。）

`src/lib/sessionCookie.ts`：

```ts
// 多教室上線時改掉 session cookie 名稱：舊 cookie（沒有 classroomId）會自動失效，
// 每個人都重新登入一次。middleware 跑在 edge，所以這裡不能 import 任何 Node 模組。
export const USE_SECURE_COOKIES = process.env.NEXTAUTH_URL ? process.env.NEXTAUTH_URL.startsWith('https://') : !!process.env.VERCEL;
export const SESSION_COOKIE_NAME = `${USE_SECURE_COOKIES ? '__Secure-' : ''}mup.session-token`;
```

`src/lib/tenant.ts`：

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { SESSION_COOKIE_NAME } from './sessionCookie';

// 多教室隔離的「目前在哪間教室」。解析順序：
// 1. withClassroom / asPlatform 設定的明確範圍（排程、登入流程、平台後台用）
// 2. 測試：vitest.setup 每個測試前設定的預設教室
// 3. 正式執行：當次請求的 session（next/headers cookies → getServerSession）
// 三者都沒有就 fail-closed，丟 NO_CLASSROOM_CONTEXT。
export type TenantScope = { kind: 'classroom'; classroomId: string } | { kind: 'platform' };

const storage = new AsyncLocalStorage<TenantScope>();
let testDefaultClassroomId: string | null = null;

// fn 一定要在 run 裡 await：PrismaPromise 是 lazy 的，直接 return 會在離開範圍之後才執行。
export function withClassroom<T>(classroomId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ kind: 'classroom', classroomId }, async () => await fn());
}

export function asPlatform<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ kind: 'platform' }, async () => await fn());
}

export function setTestDefaultClassroom(id: string | null): void {
  if (!process.env.VITEST) throw new Error('TEST_ONLY');
  testDefaultClassroomId = id;
}

const sessionCache = new Map<string, { classroomId: string; expiresAt: number }>();
const SESSION_CACHE_TTL_MS = 60_000;

async function classroomIdFromRequestSession(): Promise<string | null> {
  let token: string | undefined;
  try {
    const { cookies } = await import('next/headers');
    token = cookies().get(SESSION_COOKIE_NAME)?.value;
  } catch {
    return null; // 不在請求範圍內（例如 module 初始化）
  }
  if (!token) return null;
  const hit = sessionCache.get(token);
  if (hit && hit.expiresAt > Date.now()) return hit.classroomId;
  const [{ getServerSession }, { authOptions }] = await Promise.all([import('next-auth'), import('./auth')]);
  const session = await getServerSession(authOptions);
  const classroomId = session?.user?.classroomId ?? null;
  if (classroomId) {
    if (sessionCache.size > 5000) sessionCache.clear();
    sessionCache.set(token, { classroomId, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
  }
  return classroomId;
}

export async function resolveScope(): Promise<TenantScope> {
  const explicit = storage.getStore();
  if (explicit) return explicit;
  if (process.env.VITEST) {
    if (testDefaultClassroomId) return { kind: 'classroom', classroomId: testDefaultClassroomId };
    throw new Error('NO_CLASSROOM_CONTEXT');
  }
  const classroomId = await classroomIdFromRequestSession();
  if (!classroomId) throw new Error('NO_CLASSROOM_CONTEXT');
  return { kind: 'classroom', classroomId };
}

export async function currentClassroomId(): Promise<string> {
  const scope = await resolveScope();
  if (scope.kind !== 'classroom') throw new Error('PLATFORM_SCOPE_HAS_NO_CLASSROOM');
  return scope.classroomId;
}
```

（`session.user.classroomId` 的型別在 Task 4 加進 `next-auth.d.ts`。這一步如果 tsc 報這個屬性不存在，先寫 `(session?.user as { classroomId?: string } | undefined)?.classroomId`，Task 4 再改回直接存取。）

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/classroomCode.test.ts src/lib/tenant.test.ts`
Expected: PASS。（這個時間點 vitest.setup 還沒設預設教室，tenant.test 的 afterEach 會設成一個假 id，不影響其他測試。）

- [ ] **Step 5: Commit**

```bash
git add src/lib/classroomCode.ts src/lib/classroomCode.test.ts src/lib/sessionCookie.ts src/lib/tenant.ts src/lib/tenant.test.ts
git commit -m "feat: 教室代碼規則與租戶範圍模組（withClassroom/asPlatform/fail-closed）"
```

---

### Task 2: Schema 多租戶化＋統一過濾器＋測試環境

這個任務完成後，全部既有測試都要回到全綠，所以不能再拆。

**Files:**
- Create: `scripts/tenantize-schema.py`
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/db.ts`
- Create: `src/lib/testUtils/classroom.ts`
- Modify: `vitest.setup.ts`
- Create: `src/lib/tenantSchema.test.ts`
- Modify: `src/lib/services/closedDayService.ts`, `subjectColorService.ts`, `billingSettingService.ts`, `attendanceService.ts`, `classService.ts`, `billingBatchService.ts`, `billEditService.ts`
- Modify: `src/lib/tenant.test.ts`（afterEach 改成恢復 vitest.setup 建好的預設教室）

**Interfaces:**
- Consumes: Task 1 的 `resolveScope`、`currentClassroomId`、`setTestDefaultClassroom`
- Produces:
  - Prisma：`Classroom { id, code @unique, name, logoPath?, active @default(true), createdAt }`。
  - 48 個租戶 model 都有 `classroomId`（DB 預設值 `current_setting('app.classroom_id')`）、`@@unique([classroomId, id])`、`@@index([classroomId])`。
  - 唯一鍵改成教室內唯一：`User @@unique([classroomId, email])`、`Student @@unique([classroomId, studentNumber])`、`ClosedDay @@unique([classroomId, date])`、`SubjectColor @@unique([classroomId, subject])`、`ActivityCategory @@unique([classroomId, name])`、`BillingSetting classroomId @unique`。
  - `src/lib/db.ts` 的 `prisma` 已套上擴充；額外匯出 `TENANT_MODELS: ReadonlySet<string>`。
  - `src/lib/testUtils/classroom.ts`：`createClassroom(code: string, name?: string): Promise<{ id: string; code: string }>`、`createTestClassroom(): Promise<string>`（建立代碼 `testroom` 的教室並設為預設）。

- [ ] **Step 1: 寫 schema 改寫腳本** `scripts/tenantize-schema.py`

```python
#!/usr/bin/env python3
"""一次性：把 prisma/schema.prisma 改成多租戶（多教室）。可重跑，已改過的不會重複改。"""
import re, sys
from pathlib import Path

P = Path('prisma/schema.prisma')
s = P.read_text()
if 'model Classroom {' in s:
    print('already tenantized'); sys.exit(0)

model_re = re.compile(r'^model (\w+) \{\n(.*?)^\}', re.S | re.M)
models = [m.group(1) for m in model_re.finditer(s)]
TENANT = set(models)                       # 現有 48 個 model 全部是租戶 model
SINGLE_FK_EXCEPTIONS = {('GoHallTicketTransaction', 'session')}
PER_CLASSROOM_UNIQUE = {('User', 'email'), ('Student', 'studentNumber'), ('ClosedDay', 'date'),
                        ('SubjectColor', 'subject'), ('ActivityCategory', 'name')}
DEFAULT = '@default(dbgenerated("current_setting(\'app.classroom_id\')"))'

def lcfirst(n): return n[0].lower() + n[1:]

def transform(name, body):
    lines = body.rstrip('\n').split('\n')
    out, extra, one_to_one_fks = [], [], []
    fk_fields = set(re.findall(r'fields: \[(\w+)\]', body))
    for line in lines:
        stripped = line.strip()
        toks = stripped.split()
        # 1) 教室內唯一的欄位：拿掉欄位層級的 @unique，改成 @@unique([classroomId, 欄位])
        if toks and (name, toks[0]) in PER_CLASSROOM_UNIQUE and '@unique' in line:
            line = line.replace(' @unique', '')
            extra.append(f'  @@unique([classroomId, {toks[0]}])')
        # 2) 一對一關聯的 FK（欄位上有 @unique）：保留 @unique，另外加 @@unique([classroomId, fk])
        elif toks and toks[0] in fk_fields and '@unique' in line:
            one_to_one_fks.append(toks[0])
        # 3) 指向租戶 model 的關聯：改成複合外鍵
        m = re.search(r'fields: \[(\w+)\], references: \[id\]', line)
        if m and len(toks) >= 2:
            target = toks[1].rstrip('?').rstrip('[]')
            if target in TENANT and (name, toks[0]) not in SINGLE_FK_EXCEPTIONS:
                line = line.replace(m.group(0), f'fields: [classroomId, {m.group(1)}], references: [classroomId, id]')
        out.append(line)
    # 插在 @id 那一行後面
    idx = next(i for i, l in enumerate(out) if '@id' in l)
    out.insert(idx + 1, f'  classroomId String {DEFAULT}')
    out.insert(idx + 2, '  classroom   Classroom @relation(fields: [classroomId], references: [id], onDelete: Restrict)')
    for fk in one_to_one_fks:
        extra.append(f'  @@unique([classroomId, {fk}])')
    extra += ['  @@unique([classroomId, id])', '  @@index([classroomId])']
    return '\n'.join(out) + '\n\n' + '\n'.join(extra) + '\n'

s = model_re.sub(lambda m: f'model {m.group(1)} {{\n{transform(m.group(1), m.group(2))}}}', s)

back = '\n'.join(f'  {lcfirst(n)}Rows {n}[]' for n in models)
s += f'''
// 教室＝租戶（一個獨立客戶）。見 docs/superpowers/specs/2026-09-29-multi-classroom-design.md
model Classroom {{
  id        String   @id @default(cuid())
  code      String   @unique // 登入用的教室代碼（小寫，規則見 src/lib/classroomCode.ts），建立後不可改
  name      String
  logoPath  String?
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
{back}
}}
'''
P.write_text(s)
print(f'tenantized {len(models)} models')
```

- [ ] **Step 2: 跑腳本，手動處理 BillingSetting，再驗證**

Run: `python3 scripts/tenantize-schema.py`
Expected: `tenantized 48 models`

然後手動修改 `BillingSetting`：把 `id String @id @default("main")` 改成 `id String @id @default(cuid())`，在 model 最後加上 `@@unique([classroomId])`，並把註解「單列設定（id 固定 "main"）」改成「每間教室一列」。

Run: `npx prisma format && npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid`。若驗證失敗，只調整 schema 本身，不修改腳本以外的規則。

- [ ] **Step 3: 在 `src/lib/db.ts` 加上統一過濾器**

保留現有的 `createPrismaClient`，以及 global 快取的註解與邏輯。檔案最後改成：

```ts
import { Prisma } from '@prisma/client';
import { resolveScope } from './tenant';

// 有 classroomId 欄位的 model 就是租戶 model（除了 Classroom 本身以外全部都是）。
export const TENANT_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === 'classroomId')).map((m) => m.name)
);

const WHERE_OPERATIONS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'update', 'updateMany', 'updateManyAndReturn', 'delete', 'deleteMany', 'count', 'aggregate', 'groupBy',
]);

// 多教室統一過濾器：租戶 model 的每個查詢都自動限定在目前教室，建立時自動寫入
// classroomId（呼叫端傳入的值會被覆蓋，不可能寫到別間教室）。平台範圍（asPlatform）
// 不過濾。沒有範圍時 resolveScope 會丟 NO_CLASSROOM_CONTEXT（fail-closed）。
// 跨教室「關聯」由 DB 的複合外鍵 (classroomId, xId) 擋下，不在這裡處理。
function withTenantFilter(client: PrismaClient) {
  return client.$extends({
    name: 'tenant',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          const scope = await resolveScope();
          if (scope.kind === 'platform') return query(args);
          const classroomId = scope.classroomId;
          const a = { ...(args as Record<string, unknown>) } as Record<string, any>;
          if (operation === 'create') a.data = { ...a.data, classroomId };
          else if (operation === 'createMany' || operation === 'createManyAndReturn') {
            a.data = (Array.isArray(a.data) ? a.data : [a.data]).map((d: Record<string, unknown>) => ({ ...d, classroomId }));
          } else if (operation === 'upsert') {
            a.where = { ...a.where, classroomId };
            a.create = { ...a.create, classroomId };
          } else if (WHERE_OPERATIONS.has(operation)) a.where = { ...(a.where ?? {}), classroomId };
          else throw new Error(`TENANT_UNSUPPORTED_OPERATION:${model}.${operation}`);
          return query(a);
        },
      },
    },
  });
}
```

`prisma` 的匯出改成 `export const prisma = withTenantFilter(<原本的 base client>);`。global 快取仍然只快取 base client，擴充是每次載入 module 時才套上的。

- [ ] **Step 4: 測試環境建立預設教室**

`src/lib/testUtils/classroom.ts`：

```ts
import { prisma } from '@/lib/db';
import { setTestDefaultClassroom } from '@/lib/tenant';

// Classroom 不是租戶 model，不需要範圍就能建立。
export async function createClassroom(code: string, name = `${code} 教室`) {
  return prisma.classroom.create({ data: { code, name }, select: { id: true, code: true } });
}

export async function createTestClassroom(): Promise<string> {
  const { id } = await createClassroom('testroom', '測試教室');
  setTestDefaultClassroom(id);
  return id;
}
```

`vitest.setup.ts`（`DATABASE_URL` 那一行保持在最上面，並維持各 worktree 自己的測試 DB 名稱）：

```ts
beforeEach(async () => {
  const { resetDb } = await import('@/lib/testUtils/resetDb');
  await resetDb();
  const { createTestClassroom } = await import('@/lib/testUtils/classroom');
  await createTestClassroom();
});
```

`src/lib/tenant.test.ts` 的 `afterEach` 改成不做任何事（下一個測試的 beforeEach 會重建預設教室），直接刪掉那一行。

- [ ] **Step 5: 推 schema 到測試 DB，跑一次全套，蒐集錯誤**

Run: `DATABASE_URL=<本 worktree 專用測試 DB> npx prisma db push --accept-data-loss && npx prisma generate && npx tsc --noEmit 2>&1 | head -60`
Expected：tsc 會在下面幾處報錯，照 Step 6 修正。

- [ ] **Step 6: 修正依賴「全系統唯一」或原生 SQL 的程式**

1. `closedDayService.ts` 的 `addClosedDay`：`prisma.closedDay.findUnique({ where: { date } })` 改成 `prisma.closedDay.findFirst({ where: { date } })`（過濾器會自動限定教室）。
2. `subjectColorService.ts` 的 upsert：`where: { subject }` 改成 `where: { classroomId_subject: { classroomId: await currentClassroomId(), subject } }`。
3. `billingSettingService.ts` 兩處 upsert：
   ```ts
   const classroomId = await currentClassroomId();
   const row = await prisma.billingSetting.upsert({ where: { classroomId }, create: {}, update: {} });
   ```
   `updateBillingSetting` 同樣改成 `where: { classroomId }, create: { ...input }, update: input`。
4. `attendanceService.ts` 兩處 `prisma.student.findUnique({ where: { studentNumber: code }, ...})` 改成 `findFirst`，其他參數不變。
5. `classService.ts` 兩處巢狀 `periods: { create: { sessions: X } }` 改成 `periods: { create: { sessions: X, classroomId } }`，並在該函式開頭加上 `const classroomId = await currentClassroomId();`。
6. 三處 `$executeRaw`（`classService.ts`、`billingBatchService.ts` 的 `deleteBill`、`billEditService.ts`）的 `WHERE "id" = ${...}` 後面都補上 `AND "classroomId" = ${classroomId}`，並在 raw 之前取得 `const classroomId = await currentClassroomId();`。raw 不經過過濾器，這一行就是它的防線。
7. 其他 tsc 錯誤：若是 `Prisma.TransactionClient` 跟擴充後的 client 型別不相容，把參數型別改成 `Prisma.TransactionClient | typeof prisma`（沿用 `goHallTicketService` 的 `ClientType` 寫法）。不准用 `as any` 蓋掉。

import 一律寫 `import { currentClassroomId } from '@/lib/tenant';`。

- [ ] **Step 7: 寫結構守門測試** `src/lib/tenantSchema.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { TENANT_MODELS } from './db';

const models = Prisma.dmmf.datamodel.models;
const NON_TENANT = new Set(['Classroom']);
const SINGLE_FK_EXCEPTIONS = new Set(['GoHallTicketTransaction.session']);

describe('多教室結構守門', () => {
  it('除了 Classroom 以外每個 model 都有 classroomId（DB 預設值 current_setting）', () => {
    for (const m of models) {
      if (NON_TENANT.has(m.name)) continue;
      const f = m.fields.find((x) => x.name === 'classroomId');
      expect(f, `${m.name} 缺 classroomId`).toBeDefined();
      expect(JSON.stringify(f!.default), `${m.name}.classroomId 預設值`).toContain('current_setting');
      expect(TENANT_MODELS.has(m.name)).toBe(true);
    }
  });

  it('每個租戶 model 都有 @@unique([classroomId, id])', () => {
    for (const m of models) {
      if (NON_TENANT.has(m.name)) continue;
      const has = m.uniqueFields.some((u) => u.length === 2 && u[0] === 'classroomId' && u[1] === 'id');
      expect(has, `${m.name} 缺 @@unique([classroomId, id])`).toBe(true);
    }
  });

  it('指向租戶 model 的關聯都是複合外鍵（除了明列的例外）', () => {
    for (const m of models) {
      for (const f of m.fields) {
        if (f.kind !== 'object' || !f.relationFromFields || f.relationFromFields.length === 0) continue;
        if (NON_TENANT.has(f.type)) continue;
        if (SINGLE_FK_EXCEPTIONS.has(`${m.name}.${f.name}`)) continue;
        expect(f.relationFromFields, `${m.name}.${f.name}`).toContain('classroomId');
        expect(f.relationToFields, `${m.name}.${f.name}`).toContain('classroomId');
      }
    }
  });

  it('教室內唯一的欄位', () => {
    const uniques = (name: string) => models.find((m) => m.name === name)!.uniqueFields.map((u) => u.join(','));
    expect(uniques('User')).toContain('classroomId,email');
    expect(uniques('Student')).toContain('classroomId,studentNumber');
    expect(uniques('ClosedDay')).toContain('classroomId,date');
    expect(uniques('SubjectColor')).toContain('classroomId,subject');
    expect(uniques('ActivityCategory')).toContain('classroomId,name');
  });
});
```

- [ ] **Step 8: 跑全套測試**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -15`
Expected：tsc 無錯誤；全部測試通過（原有約 1,096 個，加上本任務的新測試）。

失敗時的處理：
- `NO_CLASSROOM_CONTEXT`：代表有程式碼在 beforeEach 之前（例如 module 頂層）查詢租戶 model，要把那段查詢移進函式內。
- `unrecognized configuration parameter "app.classroom_id"`：代表有巢狀 create 沒帶 `classroomId`，照 Step 6 第 5 點補上。

不准為了讓測試通過而改寫測試的期望值。

- [ ] **Step 9: Commit**

```bash
git add scripts/tenantize-schema.py prisma/schema.prisma src/lib/db.ts src/lib/testUtils/classroom.ts vitest.setup.ts src/lib/tenantSchema.test.ts src/lib/tenant.test.ts src/lib/services/closedDayService.ts src/lib/services/subjectColorService.ts src/lib/services/billingSettingService.ts src/lib/services/attendanceService.ts src/lib/services/classService.ts src/lib/services/billingBatchService.ts src/lib/services/billEditService.ts
git commit -m "feat: schema 多租戶化（48 表 classroomId＋複合外鍵）與統一過濾器"
```

（`vitest.setup.ts` 在 worktree 裡如果設了 skip-worktree，用 `git update-index --no-skip-worktree vitest.setup.ts`，**只** commit beforeEach 的改動，測試 DB 名稱維持原本的 `tutoring_makeup_system_test`。可以用 `git add -p`，或先把 DB 名稱暫時改回原值再 add，add 完再改回專用名稱並重新設 skip-worktree。）

---

### Task 3: 跨教室隔離測試套件

**Files:**
- Create: `src/lib/tenantIsolation.test.ts`

**Interfaces:**
- Consumes：Task 2 的 `createClassroom`、`prisma`、`TENANT_MODELS`；Task 1 的 `withClassroom`、`setTestDefaultClassroom`；既有的 service：`createTeacher({name,email,password,subjects})`、`createStudent({name,email,password})`、`createClass({...})`、`enrollStudent(classId, studentId)`、`listStudents(opts?)`、`createGoHallBill(input, now?)`、`createStandaloneClassBill(input, now?)`、`deleteBill(billId)`。

- [ ] **Step 1: 寫測試**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => sessionMock(...a) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { Prisma } from '@prisma/client';
import { prisma, TENANT_MODELS } from '@/lib/db';
import { withClassroom, setTestDefaultClassroom } from '@/lib/tenant';
import { createClassroom } from '@/lib/testUtils/classroom';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent, listStudents } from '@/lib/services/studentService';
import { createClass, enrollStudent } from '@/lib/services/classService';
import { createGoHallBill } from '@/lib/services/goHallBillService';
import { createStandaloneClassBill } from '@/lib/services/standaloneBillService';
import { deleteBill } from '@/lib/services/billingBatchService';
import { GET as studentsGET } from '@/app/api/students/route';

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

// 在 B 教室建一組橫跨多張表的資料（帳號、老師、學生、班級、報名、期別、帳單、堂票帳本）
async function seedClassroom(classroomId: string, tag: string) {
  return withClassroom(classroomId, async () => {
    const teacher = await createTeacher({ name: `${tag}老師`, email: 'same@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: `${tag}學生`, email: 'kid@example.com', password: 'x' });
    const cls = await createClass({ name: `${tag}班`, subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
    await enrollStudent(cls.id, student.id);
    await createGoHallBill({ item: 'TICKETS', studentId: student.id, sessions: 3, unitPrice: 300, amountDue: 900, notifyNow: false }, D(2026, 9, 29));
    return { teacher, student, cls };
  });
}

describe('跨教室隔離', () => {
  let A: string;
  let B: string;
  let b: Awaited<ReturnType<typeof seedClassroom>>;

  beforeEach(async () => {
    A = (await createClassroom('room-a')).id;
    B = (await createClassroom('room-b')).id;
    await seedClassroom(A, 'A');
    b = await seedClassroom(B, 'B');
  });

  it('同一個 email 可以在兩間教室各自存在', async () => {
    const all = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "User" WHERE email = 'same@example.com'`;
    expect(Number(all[0].n)).toBe(2);
  });

  it('每一張租戶表：A 範圍查不到任何 B 的列', async () => {
    await withClassroom(A, async () => {
      for (const model of Array.from(TENANT_MODELS)) {
        const delegate = (prisma as unknown as Record<string, { findMany: (a?: object) => Promise<{ classroomId: string }[]> }>)[
          model.charAt(0).toLowerCase() + model.slice(1)
        ];
        const rows = await delegate.findMany({ select: { classroomId: true } });
        expect(rows.every((r) => r.classroomId === A), model).toBe(true);
      }
    });
  });

  it('A 用 B 的 id 查詢、更新、刪除都碰不到', async () => {
    await withClassroom(A, async () => {
      expect(await prisma.student.findUnique({ where: { id: b.student.id } })).toBeNull();
      await expect(prisma.student.update({ where: { id: b.student.id }, data: { parentPhone: 'x' } })).rejects.toMatchObject({ code: 'P2025' });
      expect((await prisma.student.deleteMany({ where: { id: b.student.id } })).count).toBe(0);
    });
    expect(await withClassroom(B, () => prisma.student.findUnique({ where: { id: b.student.id } }))).not.toBeNull();
  });

  it('A 不能建立指向 B 資料的關聯（複合外鍵）', async () => {
    await withClassroom(A, async () => {
      const aClass = await prisma.class.findFirstOrThrow();
      await expect(enrollStudent(aClass.id, b.student.id)).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });
  });

  it('service 與 API 層只回傳自己教室', async () => {
    const names = await withClassroom(A, async () => (await listStudents()).map((s) => s.user.name));
    expect(names).toEqual(['A學生']);
    sessionMock.mockResolvedValue({ user: { id: 'x', role: 'ADMIN' } });
    const res = await withClassroom(A, () => studentsGET());
    const body = (await res.json()) as { user: { name: string } }[];
    expect(body.map((s) => s.user.name)).toEqual(['A學生']);
  });

  it('fail-closed：沒有任何範圍時查租戶表會拋錯', async () => {
    setTestDefaultClassroom(null);
    await expect(prisma.student.findMany()).rejects.toThrow('NO_CLASSROOM_CONTEXT');
  });

  it('巢狀 create 忘了帶 classroomId 會被 DB 擋下', async () => {
    await withClassroom(A, async () => {
      const enr = await prisma.classEnrollment.findFirstOrThrow();
      await expect(
        prisma.classEnrollment.update({ where: { id: enr.id }, data: { periods: { create: { sessions: 1 } } } })
      ).rejects.toThrow();
    });
  });

  it('A 範圍呼叫 deleteBill(B 的帳單) 失敗，B 的帳單與堂數都不變', async () => {
    const bBill = await withClassroom(B, () =>
      createStandaloneClassBill({
        studentId: b.student.id, classId: b.cls.id, periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30),
        billedSessions: 4, amountDue: 2000, notifyNow: false,
      })
    );
    const before = await withClassroom(B, () => prisma.classEnrollment.findFirstOrThrow({ select: { totalSessions: true } }));
    await withClassroom(A, async () => {
      await expect(deleteBill(bBill.billId)).rejects.toThrow();
    });
    const after = await withClassroom(B, () => prisma.classEnrollment.findFirstOrThrow({ select: { totalSessions: true } }));
    expect(after.totalSessions).toBe(before.totalSessions);
    expect(await withClassroom(B, () => prisma.bill.findUnique({ where: { id: bBill.billId } }))).not.toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試**

Run: `npx vitest run src/lib/tenantIsolation.test.ts`
Expected: PASS。如果某個 model 在「每一張租戶表」那個測試失敗，代表過濾器或 schema 有漏洞：回頭修 Task 2 的程式，不准改這個測試。如果 `createTeacher`、`createGoHallBill` 等的實際簽名和上面不同，依實際簽名調整呼叫方式，期望值不准改。

- [ ] **Step 3: Commit**

```bash
git add src/lib/tenantIsolation.test.ts
git commit -m "test: 跨教室隔離測試（全表掃描、id 越權、複合外鍵、fail-closed、巢狀 create）"
```

---

### Task 4: 登入改成教室代碼＋帳號＋密碼

**Files:**
- Create: `src/lib/services/classroomService.ts`, `src/lib/services/classroomService.test.ts`
- Create: `src/lib/services/authService.ts`, `src/lib/services/authService.test.ts`
- Modify: `src/lib/auth.ts`, `src/types/next-auth.d.ts`, `src/middleware.ts`, `src/app/login/page.tsx`, `src/lib/services/familyService.ts`

**Interfaces:**
- Consumes：Task 1 的 `normalizeClassroomCode`、`withClassroom`、`asPlatform`、`SESSION_COOKIE_NAME`、`USE_SECURE_COOKIES`；Task 2 的 `createClassroom`
- Produces:
  ```ts
  // classroomService.ts
  export function findClassroomByCode(rawCode: string): Promise<{ id: string; code: string; name: string; active: boolean } | null>
  export function listActiveClassroomIds(): Promise<string[]>
  export function runForEachActiveClassroom<T>(job: () => Promise<T>): Promise<Record<string, T | { error: true }>>
  // authService.ts
  export type AuthResult =
    | { ok: true; user: { id: string; name: string; email: string; role: Role; classroomId: string } }
    | { ok: false; reason: 'INVALID' | 'CLASSROOM_DISABLED' }
  export function authenticate(input: { classroomCode: string; email: string; password: string }): Promise<AuthResult>
  ```
  - session 與 JWT 加上 `classroomId: string`。

- [ ] **Step 1: 寫失敗的測試**

`src/lib/services/classroomService.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createClassroom } from '@/lib/testUtils/classroom';
import { findClassroomByCode, listActiveClassroomIds, runForEachActiveClassroom } from './classroomService';
import { currentClassroomId } from '@/lib/tenant';

describe('classroomService', () => {
  it('依代碼找教室，不分大小寫、會 trim', async () => {
    const c = await createClassroom('hjjdaya');
    expect((await findClassroomByCode('  HJJDaya '))?.id).toBe(c.id);
    expect(await findClassroomByCode('nope')).toBeNull();
  });
  it('逐教室執行：只跑啟用中的，各自在自己的範圍；單一教室失敗不影響其他', async () => {
    const a = await createClassroom('room-a');
    const b = await createClassroom('room-b');
    const off = await createClassroom('room-off');
    await prisma.classroom.update({ where: { id: off.id }, data: { active: false } });
    const ids = await listActiveClassroomIds();
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(ids).not.toContain(off.id);
    const out = await runForEachActiveClassroom(async () => {
      const id = await currentClassroomId();
      if (id === b.id) throw new Error('boom');
      return id;
    });
    expect(out[a.id]).toBe(a.id);
    expect(out[b.id]).toEqual({ error: true });
    expect(out[off.id]).toBeUndefined();
  });
});
```

`src/lib/services/authService.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { withClassroom } from '@/lib/tenant';
import { createClassroom } from '@/lib/testUtils/classroom';
import { createStudent } from './studentService';
import { authenticate } from './authService';

async function setup() {
  const a = await createClassroom('room-a');
  const b = await createClassroom('room-b');
  const ua = await withClassroom(a.id, () => createStudent({ name: 'A生', email: 'same@example.com', password: 'pw-a' }));
  const ub = await withClassroom(b.id, () => createStudent({ name: 'B生', email: 'same@example.com', password: 'pw-b' }));
  return { a, b, ua, ub };
}

describe('authenticate', () => {
  it('同一個 email 依教室代碼登入不同帳號', async () => {
    const { a, b } = await setup();
    const ra = await authenticate({ classroomCode: 'ROOM-A', email: 'Same@Example.com ', password: 'pw-a' });
    const rb = await authenticate({ classroomCode: 'room-b', email: 'same@example.com', password: 'pw-b' });
    expect(ra).toMatchObject({ ok: true, user: { classroomId: a.id, name: 'A生' } });
    expect(rb).toMatchObject({ ok: true, user: { classroomId: b.id, name: 'B生' } });
  });
  it('代碼錯、帳號錯、密碼錯（含用別間教室的密碼）都回 INVALID', async () => {
    await setup();
    expect(await authenticate({ classroomCode: 'nope', email: 'same@example.com', password: 'pw-a' })).toEqual({ ok: false, reason: 'INVALID' });
    expect(await authenticate({ classroomCode: 'room-a', email: 'x@example.com', password: 'pw-a' })).toEqual({ ok: false, reason: 'INVALID' });
    expect(await authenticate({ classroomCode: 'room-a', email: 'same@example.com', password: 'pw-b' })).toEqual({ ok: false, reason: 'INVALID' });
  });
  it('教室停用：密碼正確才回 CLASSROOM_DISABLED，密碼錯仍是 INVALID', async () => {
    const { a } = await setup();
    await prisma.classroom.update({ where: { id: a.id }, data: { active: false } });
    expect(await authenticate({ classroomCode: 'room-a', email: 'same@example.com', password: 'pw-a' })).toEqual({ ok: false, reason: 'CLASSROOM_DISABLED' });
    expect(await authenticate({ classroomCode: 'room-a', email: 'same@example.com', password: 'bad' })).toEqual({ ok: false, reason: 'INVALID' });
  });
});
```

在 `src/lib/services/familyService.test.ts`（既有檔）的 `describe('redeemSwitchToken', …)` 裡追加一個測試（沿用該檔既有的 `userIdOf` helper；import 補上 `withClassroom` 與 `createClassroom`）：

```ts
  it('在別間教室的範圍裡兌換，仍回到 token 所屬教室的帳號', async () => {
    const a = await createStudent({ name: '哥哥', email: 'fa@example.com', password: 'x' });
    const b = await createStudent({ name: '妹妹', email: 'fb@example.com', password: 'x' });
    await setSiblings(a.id, [b.id]);
    const token = await createSwitchToken(await userIdOf(a.id), b.id);
    const other = await createClassroom('room-other');
    const user = await withClassroom(other.id, () => redeemSwitchToken(token));
    expect(user?.id).toBe(await userIdOf(b.id));
    const { prisma } = await import('@/lib/db');
    const target = await prisma.student.findUniqueOrThrow({ where: { id: b.id } });
    expect(user?.classroomId).toBe(target.classroomId);
    expect(await redeemSwitchToken(token)).toBeNull();
  });
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/classroomService.test.ts src/lib/services/authService.test.ts`
Expected: FAIL（找不到模組）

- [ ] **Step 3: 實作 service**

`src/lib/services/classroomService.ts`：

```ts
import { prisma } from '@/lib/db';
import { withClassroom } from '@/lib/tenant';
import { normalizeClassroomCode } from '@/lib/classroomCode';

// Classroom 不是租戶 model：這些查詢不需要教室範圍（登入前、排程）。
export function findClassroomByCode(rawCode: string) {
  return prisma.classroom.findUnique({
    where: { code: normalizeClassroomCode(rawCode) },
    select: { id: true, code: true, name: true, active: true },
  });
}

export async function listActiveClassroomIds(): Promise<string[]> {
  const rows = await prisma.classroom.findMany({ where: { active: true }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => r.id);
}

// 排程逐教室執行：每間教室在自己的範圍裡跑，單一教室失敗只記 log，不影響其他教室。
export async function runForEachActiveClassroom<T>(job: () => Promise<T>): Promise<Record<string, T | { error: true }>> {
  const results: Record<string, T | { error: true }> = {};
  for (const id of await listActiveClassroomIds()) {
    try {
      results[id] = await withClassroom(id, job);
    } catch (err) {
      console.error(`classroom job failed for ${id}`, err);
      results[id] = { error: true };
    }
  }
  return results;
}
```

`src/lib/services/authService.ts`：

```ts
import bcrypt from 'bcryptjs';
import type { Role } from '@prisma/client';
import { withClassroom } from '@/lib/tenant';
import { findClassroomByCode } from './classroomService';
import { findUserByEmailInsensitive } from './userService';

export type AuthResult =
  | { ok: true; user: { id: string; name: string; email: string; role: Role; classroomId: string } }
  | { ok: false; reason: 'INVALID' | 'CLASSROOM_DISABLED' };

// 任何一項錯誤都回 INVALID（不透露是代碼、帳號還是密碼錯）。教室停用要在
// 密碼驗證通過之後才回報，避免有人藉此試出哪些教室代碼存在。
export async function authenticate(input: { classroomCode: string; email: string; password: string }): Promise<AuthResult> {
  const classroom = await findClassroomByCode(input.classroomCode);
  if (!classroom) return { ok: false, reason: 'INVALID' };
  // 登入時還沒有 session：明確指定要在哪一間教室查帳號
  const user = await withClassroom(classroom.id, () => findUserByEmailInsensitive(input.email));
  if (!user) return { ok: false, reason: 'INVALID' };
  if (!(await bcrypt.compare(input.password, user.password))) return { ok: false, reason: 'INVALID' };
  if (!classroom.active) return { ok: false, reason: 'CLASSROOM_DISABLED' };
  return { ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, classroomId: classroom.id } };
}
```

`familyService.ts` 的 `redeemSwitchToken`：token 是全系統唯一的隨機值，要先用 `asPlatform` 找到 token 所屬的教室，後續操作都在該教室的範圍裡做，回傳值也要帶上 `classroomId`：

```ts
export async function redeemSwitchToken(token: string) {
  // 手足切換會在 next-auth 的 authorize 裡呼叫，這時候可能還掛著舊 session 的教室，
  // 或是根本沒有 session。用 token 反查它所屬的教室，後續只在那間教室裡操作。
  const record = await asPlatform(() => prisma.familySwitchToken.findUnique({ where: { token } }));
  if (!record || record.usedAt || record.expiresAt < new Date()) return null;
  return withClassroom(record.classroomId, async () => {
    const result = await prisma.familySwitchToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
    if (result.count === 0) return null;
    return prisma.user.findUniqueOrThrow({
      where: { id: record.targetUserId },
      select: { id: true, name: true, email: true, role: true, classroomId: true },
    });
  });
}
```

- [ ] **Step 4: next-auth 設定、型別、middleware**

`src/types/next-auth.d.ts`：在 `User`、`Session['user']`、`JWT` 三處都加上 `classroomId: string;`。

`src/lib/auth.ts`：

```ts
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { authenticate } from './services/authService';
import { redeemSwitchToken } from './services/familyService';
import { SESSION_COOKIE_NAME, USE_SECURE_COOKIES } from './sessionCookie';

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  // 改 cookie 名稱：舊的（沒有 classroomId 的）session 全部自動失效，多教室上線時每個人重新登入一次。
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: USE_SECURE_COOKIES },
    },
  },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        classroomCode: { label: 'Classroom', type: 'text' },
        email: { label: 'Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
        switchToken: { label: 'Switch Token', type: 'text' },
      },
      async authorize(credentials) {
        if (credentials?.switchToken) {
          const user = await redeemSwitchToken(credentials.switchToken);
          if (!user) return null;
          return { id: user.id, name: user.name, email: user.email, role: user.role, classroomId: user.classroomId };
        }
        if (!credentials?.classroomCode || !credentials?.email || !credentials?.password) return null;
        const result = await authenticate({
          classroomCode: credentials.classroomCode,
          email: credentials.email,
          password: credentials.password,
        });
        if (!result.ok) {
          // next-auth 會把 authorize 丟出的訊息放進 signIn 結果的 error 欄位，前端據此顯示「教室已停用」
          if (result.reason === 'CLASSROOM_DISABLED') throw new Error('CLASSROOM_DISABLED');
          return null;
        }
        return result.user;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.classroomId = user.classroomId;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.classroomId = token.classroomId;
      return session;
    },
  },
};
```

`src/lib/tenant.ts` 的 `classroomIdFromRequestSession`：把 Task 1 暫時寫的 `as` 轉型改回 `session?.user?.classroomId`。

`src/middleware.ts`：`withAuth` 的第二個參數改成：

```ts
  {
    cookies: { sessionToken: { name: SESSION_COOKIE_NAME } },
    callbacks: { authorized: ({ token }) => !!token?.classroomId },
  }
```

並 `import { SESSION_COOKIE_NAME } from '@/lib/sessionCookie';`。

- [ ] **Step 5: 登入頁**

`src/app/login/page.tsx` 的改動：
- 新增 `classroomCode` state，放在帳號欄位上方，用 `<Input placeholder="教室代碼" autoCapitalize="none" autoCorrect="off" spellCheck={false} … required />`。
- 新增 `useEffect`：先讀 `new URLSearchParams(window.location.search).get('c')`；沒有的話再讀 `localStorage.getItem('mup.lastClassroomCode')`（包 try/catch）；有值就填入。不要用 `useSearchParams`，因為它在這一頁需要 Suspense 包起來。
- `signIn('credentials', { classroomCode, email, password, redirect: false })`。
- 登入成功後 `localStorage.setItem('mup.lastClassroomCode', classroomCode.trim().toLowerCase())`（包 try/catch）。
- 錯誤訊息：`result.error === 'CLASSROOM_DISABLED'` 時顯示「此教室已停用，請聯絡平台管理員」；其他錯誤顯示「教室代碼、帳號或密碼錯誤」。

- [ ] **Step 6: 跑測試**

Run: `npx vitest run src/lib/services/classroomService.test.ts src/lib/services/authService.test.ts src/lib/services/familyService.test.ts && npx tsc --noEmit && npx next lint --file src/app/login/page.tsx --file src/lib/auth.ts --file src/middleware.ts`
Expected: 全部通過、沒有錯誤。

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/classroomService.ts src/lib/services/classroomService.test.ts src/lib/services/authService.ts src/lib/services/authService.test.ts src/lib/services/familyService.ts src/lib/services/familyService.test.ts src/lib/auth.ts src/types/next-auth.d.ts src/middleware.ts src/app/login/page.tsx src/lib/tenant.ts
git commit -m "feat: 登入改為教室代碼＋帳號＋密碼，session 帶 classroomId、改 cookie 名稱強制重新登入"
```

---

### Task 5: 排程、延後工作、檔案路徑、腳本

**Files:**
- Modify: `src/app/api/cron/daily-reminders/route.ts`（+ `route.test.ts`）, `src/app/api/cron/tutoring-quota-reminder/route.ts`
- Modify: `src/lib/services/closedDayService.ts`（國定假日：抓一次，逐教室寫入）
- Modify: `src/lib/deferBestEffort.ts`
- Modify: `src/lib/storage.ts`
- Modify: `prisma/seed.ts`, `prisma/create-admin.ts`
- Test: `src/lib/deferBestEffort.test.ts`（新建）、既有的 `src/app/api/cron/daily-reminders/route.test.ts`

**Interfaces:**
- Consumes：Task 4 的 `runForEachActiveClassroom`；Task 1 的 `resolveScope`、`withClassroom`、`asPlatform`、`currentClassroomId`

- [ ] **Step 1: 寫失敗的測試**

`src/lib/deferBestEffort.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { withClassroom, currentClassroomId } from './tenant';
import { deferBestEffort } from './deferBestEffort';

describe('deferBestEffort 保留教室範圍', () => {
  it('延後的工作在呼叫當下的教室裡執行', async () => {
    let seen = '';
    await withClassroom('cls-x', () => deferBestEffort(async () => { seen = await currentClassroomId(); }));
    expect(seen).toBe('cls-x');
  });
});
```

`src/app/api/cron/daily-reminders/route.test.ts`：回傳結構改成 `results[jobName][classroomId]`，既有的第二個測試要跟著改，並追加一個多教室測試：

```ts
import { createClassroom } from '@/lib/testUtils/classroom';

  it('子任務拋錯不影響其餘：個輔提醒 boom，三個補課任務照跑（逐教室）', async () => {
    const res = await GET(reqWithAuth('Bearer test-secret'));
    expect(res.status).toBe(200);
    const data = await res.json();
    const only = (job: string) => Object.values(data[job] as Record<string, unknown>);
    expect(only('tutoringMissedSession')).toEqual([{ error: true }]);
    expect(only('makeupDayBefore')).toEqual([{ notified: 0 }]);
    expect(only('makeupNotFiled')).toEqual([{ notified: 0 }]);
    expect(only('pendingMakeupDigest')).toEqual([{ notified: false }]);
  });

  it('每間啟用中的教室各跑一次，停用的教室不跑', async () => {
    const a = await createClassroom('room-a');
    const off = await createClassroom('room-off');
    const { prisma } = await import('@/lib/db');
    await prisma.classroom.update({ where: { id: off.id }, data: { active: false } });
    const data = await (await GET(reqWithAuth('Bearer test-secret'))).json();
    const keys = Object.keys(data.makeupDayBefore);
    expect(keys).toContain(a.id);
    expect(keys).not.toContain(off.id);
    expect(keys).toHaveLength(2); // 預設測試教室 + room-a
  });
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/deferBestEffort.test.ts src/app/api/cron/daily-reminders/route.test.ts`

- [ ] **Step 3: 實作**

`deferBestEffort.ts`：在函式開頭先取得當下的範圍，再把 task 包在這個範圍裡執行（VITEST 分支與正式執行分支都要包）：

```ts
import { resolveScope, withClassroom, asPlatform } from './tenant';

export async function deferBestEffort(task: () => Promise<void>): Promise<void> {
  // 回應送出後，請求的 cookies 可能已經讀不到：趁現在把教室範圍抓下來，延後的工作在同一個範圍裡跑。
  const scope = await resolveScope();
  const scoped = () => (scope.kind === 'platform' ? asPlatform(task) : withClassroom(scope.classroomId, task));
  // …以下沿用原本的兩個分支，把 task() 換成 scoped()
}
```

`daily-reminders/route.ts`：
- 每個子任務改成 `runForEachActiveClassroom(<原本的函式>)`，回傳結構變成 `results[name] = { [classroomId]: result }`。
- `nationalHolidaysRefresh` 例外：把 `refreshNationalHolidaysFromDGPA` 拆成兩步。`fetchNationalHolidays(years)` 只抓一次外部資料，不碰 DB；`applyNationalHolidays(data)` 逐教室寫入（包在 `runForEachActiveClassroom` 裡）。寫入規則沿用 `refreshYearIfMissing` 的判斷：該教室該年度已有 NATIONAL 資料就跳過。

`tutoring-quota-reminder/route.ts`：`sendMonthlyQuotaReminders()` 改成 `runForEachActiveClassroom(() => sendMonthlyQuotaReminders())`。

`storage.ts`：`uploadActivityImage` 與 `uploadPrizeImage` 改成 async，folder 改成 `${await currentClassroomId()}/${activityId}`（獎品是 `${classroomId}/${prizeId}`）。已存在 DB 的舊路徑不動，照常可以讀。呼叫端本來就有 await，不需要改。

`prisma/seed.ts` 與 `prisma/create-admin.ts`：這兩個腳本用的是沒套過濾器的原生 client，改用 DB 預設值的做法：
- 在連線字串加上 `options=-c app.classroom_id=<id>`（用 `URL.searchParams.set('options', \`-c app.classroom_id=${id}\`)`），讓每筆 insert 都自動帶到這間教室。
- `seed.ts`：先建立（或 upsert）教室 `{ id: 'cls_hjjdaya', code: 'hjjdaya', name: '黑嘉嘉圍棋 大雅分校' }`，然後照原本的流程建立資料。
- `create-admin.ts`：從環境變數 `CLASSROOM_CODE` 讀代碼（沒有設定就結束並顯示用法），用代碼找到教室 id 後設定上述連線參數；`findUnique({ where: { email } })` 改成 `findFirst({ where: { email, classroomId } })`。
- 另外 3 支一次性回填腳本（`prisma/backfill-*.ts`、`prisma/convert-points-10-to-1.ts`），在檔案開頭加註解：「多教室前的一次性腳本，已執行完畢；多教室之後不可再執行」，程式不動。

- [ ] **Step 4: 跑測試**

Run: `npx vitest run src/lib/deferBestEffort.test.ts src/app/api/cron && npx tsc --noEmit && npm test 2>&1 | tail -8`
Expected: 全部通過。

- [ ] **Step 5: Commit**

```bash
git add src/lib/deferBestEffort.ts src/lib/deferBestEffort.test.ts src/app/api/cron src/lib/services/closedDayService.ts src/lib/storage.ts prisma/seed.ts prisma/create-admin.ts prisma/backfill-normalize-attendance-times.ts prisma/backfill-periods-and-notices.ts prisma/convert-points-10-to-1.ts
git commit -m "feat: 排程逐教室執行、延後工作保留教室範圍、上傳路徑加教室前綴、腳本支援教室"
```

---

### Task 6: 正式站搬遷 SQL、驗證、效能比較、上線手冊

**Files:**
- Create: `docs/superpowers/2026-09-29-multi-classroom-production.sql`
- Create: `docs/superpowers/2026-09-29-multi-classroom-rollout.md`
- Create: `scripts/perf-compare.ts`

- [ ] **Step 1: 產生差異 SQL**

```bash
git show main:prisma/schema.prisma > /tmp/schema-before.prisma
npx prisma migrate diff --from-schema-datamodel /tmp/schema-before.prisma --to-schema-datamodel prisma/schema.prisma --script > /tmp/mt-diff.sql
```

（如果 Prisma 7 的參數名稱不同，用 `npx prisma migrate diff --help` 查出對應寫法。）

- [ ] **Step 2: 包成可以在正式站跑的 SQL**

在 `docs/superpowers/2026-09-29-multi-classroom-production.sql` 裡依序放：

```sql
-- 多教室第一階段：現有資料全部搬進教室 hjjdaya。執行前務必先備份整個資料庫。
-- 在 Supabase SQL Editor 整份一次執行（包在同一個 transaction 裡，失敗會整份回滾）。
BEGIN;
SET LOCAL app.classroom_id = 'cls_hjjdaya';   -- 新欄位的 DEFAULT 會用它回填所有既有列

-- 1) 先建立 Classroom 表與作者教室（從 /tmp/mt-diff.sql 搬出 CREATE TABLE "Classroom" 和它的索引放在這裡）
-- <CREATE TABLE "Classroom" ...>
INSERT INTO "Classroom" ("id", "code", "name", "active", "createdAt")
VALUES ('cls_hjjdaya', 'hjjdaya', '黑嘉嘉圍棋 大雅分校', true, now())
ON CONFLICT ("id") DO NOTHING;

-- 2) 其餘 /tmp/mt-diff.sql 的內容照原順序貼上：
--    - 加欄位（ADD COLUMN "classroomId" ... NOT NULL DEFAULT current_setting(...)，靠上面的 SET LOCAL 回填）
--    - 拿掉舊的唯一鍵與外鍵、建立新的複合唯一鍵、索引與複合外鍵
-- <其餘 diff>

COMMIT;

-- 3) 驗證（應該全部為 0）
SELECT 'rows not in hjjdaya' AS check, count(*) FROM "User" WHERE "classroomId" <> 'cls_hjjdaya'
UNION ALL SELECT 'classrooms', count(*) - 1 FROM "Classroom";
```

注意：`SET LOCAL` 只在 transaction 裡有效，所以整份一定要包在 `BEGIN … COMMIT` 裡。diff 產生的 `CREATE TABLE "Classroom"` 要搬到 INSERT 之前（加欄位時 FK 驗證需要這一列已經存在）。

- [ ] **Step 3: 在開發 DB 的複本上驗證**

```bash
createdb -h localhost -U postgres mt_migration_check
pg_dump -h localhost -U postgres tutoring_makeup_system | psql -q -h localhost -U postgres mt_migration_check
psql -h localhost -U postgres -d mt_migration_check -v ON_ERROR_STOP=1 -f docs/superpowers/2026-09-29-multi-classroom-production.sql
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mt_migration_check npx prisma migrate diff --from-config-datasource --to-schema-datamodel prisma/schema.prisma --exit-code
```

Expected：SQL 執行沒有錯誤；驗證查詢兩列都是 0；`migrate diff --exit-code` 回報沒有差異（exit code 0）。如果有差異，修正 SQL 後重新產生複本再驗證。另外抽查三張表的列數，跟搬遷前的開發 DB 一致：

```bash
for t in User Bill ClassAttendance; do for db in tutoring_makeup_system mt_migration_check; do echo -n "$t@$db: "; psql -h localhost -U postgres -d $db -At -c "select count(*) from \"$t\""; done; done
```

- [ ] **Step 4: 效能比較腳本** `scripts/perf-compare.ts`

```ts
// 用法：npx tsx scripts/perf-compare.ts <DATABASE_URL> [classroomId]
// 在搬遷前（不帶 classroomId）與搬遷後（帶 cls_hjjdaya）各跑一次，比較三個熱門查詢的中位數耗時。
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const [url, classroomId] = process.argv.slice(2);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const where = classroomId ? { classroomId } : {};

async function time(label: string, fn: () => Promise<unknown>) {
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    await fn();
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  console.log(`${label.padEnd(24)} median ${samples[10].toFixed(1)}ms`);
}

(async () => {
  await time('students+enrollments', () => prisma.student.findMany({ where, include: { user: true, enrollments: true } }));
  await time('bills overview', () => prisma.bill.findMany({ where: { ...where, status: 'FINALIZED' }, include: { payments: true } }));
  await time('class attendance 90d', () =>
    prisma.classAttendance.findMany({ where: { ...where, date: { gte: new Date(Date.now() - 90 * 86_400_000) } } })
  );
  await prisma.$disconnect();
})();
```

Run（開發 DB 是搬遷前，check DB 是搬遷後。搬遷前那次要在 main checkout 跑，因為那邊的 Prisma client 還沒有 classroomId）：
- 搬遷後：`npx tsx scripts/perf-compare.ts postgresql://postgres:postgres@localhost:5432/mt_migration_check cls_hjjdaya`
- 搬遷前：在 main checkout 用同一支腳本，不帶 classroomId，連 `tutoring_makeup_system`

把兩次的輸出貼進上線手冊。預期搬遷後的中位數不會高於搬遷前的 1.5 倍；超過的話，就為對應查詢補上以 `classroomId` 開頭的複合索引，再測一次。

- [ ] **Step 5: 上線手冊** `docs/superpowers/2026-09-29-multi-classroom-rollout.md`

內容依序寫：
1. 事前通知家長與老師：某日晚上系統維護幾分鐘；維護後要重新登入，登入連結是 `https://<正式站網域>/login?c=hjjdaya`，教室代碼是 `hjjdaya`。
2. 備份：Supabase Dashboard → Database → Backups 確認有當天的備份；另外用 `pg_dump` 匯出一份存在本機（附上指令與連線字串的取得位置）。
3. 在 Supabase SQL Editor 執行 `docs/superpowers/2026-09-29-multi-classroom-production.sql`，確認最後的驗證查詢都是 0。
4. SQL 成功之後才 `git push`（Vercel 自動部署）。
5. 上線後檢查：用 `hjjdaya` 分別以行政、老師、學生登入各一次；確認點名、收費清單、學生首頁正常。
6. 回滾：從步驟 2 的備份還原 DB，並在 Vercel 把 production 部署 promote 回上一版。
7. 附上 Step 4 的效能比較結果。

- [ ] **Step 6: 本機開發 DB 也搬遷**

Run: `psql -h localhost -U postgres -d tutoring_makeup_system -v ON_ERROR_STOP=1 -f docs/superpowers/2026-09-29-multi-classroom-production.sql && dropdb -h localhost -U postgres mt_migration_check`
Expected：開發 DB 搬遷成功（之後本機 dev server 用 `hjjdaya` 登入）。

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/2026-09-29-multi-classroom-production.sql docs/superpowers/2026-09-29-multi-classroom-rollout.md scripts/perf-compare.ts
git commit -m "docs: 多教室第一階段正式站搬遷 SQL、上線手冊與效能比較腳本"
```

---

### Task 7: 瀏覽器實測（控制者執行）

不派子代理，由控制者在 worktree 的 dev server 上親自驗證：

1. `/login?c=hjjdaya` 會預填代碼；用行政、老師、學生三個身分各登入一次，首頁正常。
2. 代碼錯、密碼錯都只顯示「教室代碼、帳號或密碼錯誤」。
3. 在開發 DB 手動建第二間教室（`psql` INSERT 一間 `demo`，並用 `create-admin.ts` 建一個行政帳號），用 `demo` 登入後：學生管理、班級、收費清單都是空的；看不到任何 `hjjdaya` 的資料。
4. 回到 `hjjdaya` 登入，資料都在。
5. 把 `demo` 設成停用（`psql` UPDATE），用正確密碼登入時顯示「此教室已停用」。
6. 手足帳號切換正常。
7. 驗證完刪掉 `demo` 教室及它的資料。
