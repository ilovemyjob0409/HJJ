import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const BUCKET = 'activity-images';
const PRIZE_BUCKET = 'prize-images';
const SIGNED_URL_TTL_SECONDS = 3600;

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
  const { error } = await getClient().storage.from(bucket).upload(path, body, { contentType });
  if (error) throw new Error(error.message);
  return path;
}

async function signedUrlsFrom(bucket: string, paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const { data, error } = await getClient().storage.from(bucket).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((d) => [d.path ?? '', d.signedUrl as string]));
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

export function createPrizeSignedUrls(paths: string[]): Promise<Map<string, string>> {
  return signedUrlsFrom(PRIZE_BUCKET, paths);
}

export function deletePrizeImages(paths: string[]): Promise<void> {
  return removeFrom(PRIZE_BUCKET, paths);
}
