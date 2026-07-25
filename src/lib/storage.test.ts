import { describe, it, expect, vi, beforeEach } from 'vitest';

const uploadMock = vi.fn();
const createSignedUrlsMock = vi.fn();
const removeMock = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: uploadMock,
        createSignedUrls: createSignedUrlsMock,
        remove: removeMock,
      })),
    },
  })),
}));

beforeEach(() => {
  vi.resetModules();
  uploadMock.mockReset();
  createSignedUrlsMock.mockReset();
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
    expect(uploadMock).toHaveBeenCalledWith(path, expect.any(Buffer), { contentType: 'image/jpeg' });
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
    expect(createSignedUrlsMock).toHaveBeenCalledWith(['a/1.jpg', 'a/2.jpg'], 3600);
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
