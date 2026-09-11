import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const BUCKET = 'activity-images';
const PRIZE_BUCKET = 'prize-images';
// 簽名網址有效期拉長到 24 小時，配合下方記憶化重用同一條網址——
// 網址字串不變瀏覽器快取才吃得到（每次換新 token 等於永遠 cache miss）。
const SIGNED_URL_TTL_SECONDS = 86_400;
// 距離到期不足 1 小時就換發新的，避免頁面拿到快過期的網址
const SIGNED_URL_REFRESH_MARGIN_MS = 3_600_000;
// 上傳物件的 CDN/瀏覽器快取：路徑帶 UUID、內容永不變，快取一年安全
const UPLOAD_CACHE_CONTROL = '31536000';

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
  }
  client ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return client;
}

async function uploadTo(bucket: string, folder: string, body: Buffer, contentType: string): Promise<string> {
  const ext = EXTENSION_BY_CONTENT_TYPE[contentType];
  if (!ext) throw new Error(`Unsupported content type: ${contentType}`);
  const path = `${folder}/${randomUUID()}.${ext}`;
  const { error } = await getClient().storage.from(bucket).upload(path, body, { contentType, cacheControl: UPLOAD_CACHE_CONTROL });
  if (error) throw new Error(error.message);
  return path;
}

// 記憶化：warm instance 期間同一路徑重用同一條簽名網址（模組層 Map，
// serverless 實例回收即清空——cold start 會換發一次，之後又能快取）。
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

async function signedUrlsFrom(bucket: string, paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const now = Date.now();
  const result = new Map<string, string>();
  const missing: string[] = [];
  for (const path of paths) {
    const cached = signedUrlCache.get(`${bucket}/${path}`);
    if (cached && cached.expiresAt - SIGNED_URL_REFRESH_MARGIN_MS > now) result.set(path, cached.url);
    else missing.push(path);
  }
  if (missing.length > 0) {
    const { data, error } = await getClient().storage.from(bucket).createSignedUrls(missing, SIGNED_URL_TTL_SECONDS);
    if (error) throw new Error(error.message);
    for (const d of data ?? []) {
      if (!d.path || !d.signedUrl) continue;
      result.set(d.path, d.signedUrl as string);
      signedUrlCache.set(`${bucket}/${d.path}`, { url: d.signedUrl as string, expiresAt: now + SIGNED_URL_TTL_SECONDS * 1000 });
    }
  }
  return result;
}

async function removeFrom(bucket: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await getClient().storage.from(bucket).remove(paths);
  if (error) throw new Error(error.message);
}

export function uploadActivityImage(activityId: string, body: Buffer, contentType: string): Promise<string> {
  return uploadTo(BUCKET, activityId, body, contentType);
}

export function createSignedUrls(paths: string[]): Promise<Map<string, string>> {
  return signedUrlsFrom(BUCKET, paths);
}

export function deleteActivityImages(paths: string[]): Promise<void> {
  return removeFrom(BUCKET, paths);
}

export function uploadPrizeImage(prizeId: string, body: Buffer, contentType: string): Promise<string> {
  return uploadTo(PRIZE_BUCKET, prizeId, body, contentType);
}

// 獎品圖走公開 bucket（純商品圖無隱私）：網址固定、吃 Supabase CDN 與瀏覽器快取。
export function prizeImagePublicUrl(path: string): string | null {
  if (!process.env.SUPABASE_URL) return null;
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${PRIZE_BUCKET}/${path}`;
}

export function deletePrizeImages(paths: string[]): Promise<void> {
  return removeFrom(PRIZE_BUCKET, paths);
}
