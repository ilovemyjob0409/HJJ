import { describe, it, expect, vi, beforeEach } from 'vitest';

const uploadMock = vi.fn();
const createSignedUrlsMock = vi.fn();
const createSignedUrlMock = vi.fn();
const removeMock = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: uploadMock,
        createSignedUrls: createSignedUrlsMock,
        createSignedUrl: createSignedUrlMock,
        remove: removeMock,
      })),
    },
  })),
}));

beforeEach(() => {
  vi.resetModules();
  uploadMock.mockReset();
  createSignedUrlsMock.mockReset();
  createSignedUrlMock.mockReset();
  removeMock.mockReset();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

describe('storage', () => {
  it('throws a clear error when env vars are missing', async () => {
    delete process.env.SUPABASE_URL;
    const { createSignedUrls } = await import('./storage');
    await expect(createSignedUrls(['a/b.jpg'])).rejects.toThrow(/not configured/);
  });

  it('uploadActivityImage uploads under the activity folder with the right extension and returns the path', async () => {
    uploadMock.mockResolvedValue({ data: { path: 'x' }, error: null });
    const { uploadActivityImage } = await import('./storage');
    const path = await uploadActivityImage('act123', Buffer.from('x'), 'image/jpeg');
    expect(path).toMatch(/^act123\/[0-9a-f-]+\.jpg$/);
    expect(uploadMock).toHaveBeenCalledWith(path, expect.any(Buffer), { contentType: 'image/jpeg', cacheControl: '31536000' });
  });

  it('uploadActivityImage throws when the storage API returns an error', async () => {
    uploadMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { uploadActivityImage } = await import('./storage');
    await expect(uploadActivityImage('a', Buffer.from('x'), 'image/png')).rejects.toThrow('boom');
  });

  it('createSignedUrls maps each path to its signed url and returns empty Map for empty input', async () => {
    createSignedUrlsMock.mockResolvedValue({
      data: [
        { path: 'a/1.jpg', signedUrl: 'https://signed/1' },
        { path: 'a/2.jpg', signedUrl: 'https://signed/2' },
      ],
      error: null,
    });
    const { createSignedUrls } = await import('./storage');
    const map = await createSignedUrls(['a/1.jpg', 'a/2.jpg']);
    expect(map.get('a/1.jpg')).toBe('https://signed/1');
    expect(createSignedUrlsMock).toHaveBeenCalledWith(['a/1.jpg', 'a/2.jpg'], 86_400);
    expect((await createSignedUrls([])).size).toBe(0);
  });

  it('deleteActivityImages removes the given paths and no-ops on empty input', async () => {
    removeMock.mockResolvedValue({ data: null, error: null });
    const { deleteActivityImages } = await import('./storage');
    await deleteActivityImages(['a/1.jpg']);
    expect(removeMock).toHaveBeenCalledWith(['a/1.jpg']);
    await deleteActivityImages([]);
    expect(removeMock).toHaveBeenCalledTimes(1);
  });
});

describe('prize storage', () => {
  it('uploadPrizeImage uploads under the prize folder and returns the path', async () => {
    uploadMock.mockResolvedValue({ data: { path: 'x' }, error: null });
    const { uploadPrizeImage } = await import('./storage');
    const path = await uploadPrizeImage('prize123', Buffer.from('x'), 'image/png');
    expect(path).toMatch(/^prize123\/[0-9a-f-]+\.png$/);
    expect(uploadMock).toHaveBeenCalledWith(path, expect.any(Buffer), { contentType: 'image/png', cacheControl: '31536000' });
  });

  it('uploadPrizeImage rejects unsupported content types', async () => {
    const { uploadPrizeImage } = await import('./storage');
    await expect(uploadPrizeImage('p1', Buffer.from('x'), 'image/gif')).rejects.toThrow(/Unsupported/);
  });

  it('prizeImagePublicUrl builds a stable public URL and returns null without env', async () => {
    const { prizeImagePublicUrl } = await import('./storage');
    expect(prizeImagePublicUrl('p1/a.jpg')).toBe('https://example.supabase.co/storage/v1/object/public/prize-images/p1/a.jpg');
    delete process.env.SUPABASE_URL;
    expect(prizeImagePublicUrl('p1/a.jpg')).toBeNull();
  });

  it('prizeImageThumbUrl points at the render endpoint with width/quality', async () => {
    const { prizeImageThumbUrl } = await import('./storage');
    expect(prizeImageThumbUrl('p1/a.jpg')).toBe(
      'https://example.supabase.co/storage/v1/render/image/public/prize-images/p1/a.jpg?width=800&quality=75'
    );
  });

  it('createSignedThumbUrls signs per path with transform and memoizes', async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed-thumb/a' }, error: null });
    const { createSignedThumbUrls } = await import('./storage');
    expect((await createSignedThumbUrls(['act1/a.jpg'])).get('act1/a.jpg')).toBe('https://signed-thumb/a');
    expect((await createSignedThumbUrls(['act1/a.jpg'])).get('act1/a.jpg')).toBe('https://signed-thumb/a');
    expect(createSignedUrlMock).toHaveBeenCalledTimes(1);
    expect(createSignedUrlMock).toHaveBeenCalledWith('act1/a.jpg', 86_400, { transform: { width: 800, quality: 75 } });
  });

  it('uploads set a long cacheControl (UUID paths never change content)', async () => {
    uploadMock.mockResolvedValue({ data: { path: 'x' }, error: null });
    const { uploadActivityImage } = await import('./storage');
    const path = await uploadActivityImage('act1', Buffer.from('x'), 'image/jpeg');
    expect(uploadMock).toHaveBeenCalledWith(path, expect.any(Buffer), { contentType: 'image/jpeg', cacheControl: '31536000' });
  });

  it('createSignedUrls memoizes per path so repeated calls reuse the same URL', async () => {
    createSignedUrlsMock.mockResolvedValue({ data: [{ path: 'act1/a.jpg', signedUrl: 'https://signed/a' }], error: null });
    const { createSignedUrls } = await import('./storage');
    expect((await createSignedUrls(['act1/a.jpg'])).get('act1/a.jpg')).toBe('https://signed/a');
    expect((await createSignedUrls(['act1/a.jpg'])).get('act1/a.jpg')).toBe('https://signed/a');
    expect(createSignedUrlsMock).toHaveBeenCalledTimes(1);
  });

  it('deletePrizeImages removes paths and no-ops on empty', async () => {
    removeMock.mockResolvedValue({ data: null, error: null });
    const { deletePrizeImages } = await import('./storage');
    await deletePrizeImages(['p1/a.jpg']);
    expect(removeMock).toHaveBeenCalledWith(['p1/a.jpg']);
    removeMock.mockClear();
    await deletePrizeImages([]);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
