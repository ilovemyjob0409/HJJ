import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const BUCKET = 'activity-images';
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

export async function uploadActivityImage(activityId: string, body: Buffer, contentType: string): Promise<string> {
  const ext = EXTENSION_BY_CONTENT_TYPE[contentType];
  if (!ext) throw new Error(`Unsupported content type: ${contentType}`);
  const path = `${activityId}/${randomUUID()}.${ext}`;
  const { error } = await getClient().storage.from(BUCKET).upload(path, body, { contentType });
  if (error) throw new Error(error.message);
  return path;
}

export async function createSignedUrls(paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const { data, error } = await getClient().storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((d) => [d.path ?? '', d.signedUrl as string]));
}

export async function deleteActivityImages(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await getClient().storage.from(BUCKET).remove(paths);
  if (error) throw new Error(error.message);
}
