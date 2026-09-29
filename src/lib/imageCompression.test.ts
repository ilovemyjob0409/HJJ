import { describe, it, expect } from 'vitest';
import { fitWithin, pickSmallerJpeg } from './imageCompression';

describe('fitWithin', () => {
  it('scales the longest edge down to maxEdge, keeping aspect ratio', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200, resized: true });
    expect(fitWithin(3000, 4000, 1000)).toEqual({ width: 750, height: 1000, resized: true });
  });

  it('never upscales images already within maxEdge', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600, resized: false });
    expect(fitWithin(1000, 1000, 1000)).toEqual({ width: 1000, height: 1000, resized: false });
  });
});

describe('pickSmallerJpeg', () => {
  const jpeg = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
  const png = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'image/png' });

  it('keeps an un-resized JPEG original when re-encoding would not shrink it', () => {
    const original = jpeg(50);
    expect(pickSmallerJpeg(original, jpeg(80), false)).toBe(original);
  });

  it('uses the re-encoded blob when it is smaller', () => {
    const compressed = jpeg(30);
    expect(pickSmallerJpeg(jpeg(50), compressed, false)).toBe(compressed);
  });

  it('always uses the re-encoded blob when the image had to be resized', () => {
    const compressed = jpeg(80);
    expect(pickSmallerJpeg(jpeg(50), compressed, true)).toBe(compressed);
  });

  it('never keeps a non-JPEG original (uploads are always JPEG)', () => {
    const compressed = jpeg(80);
    expect(pickSmallerJpeg(png(50), compressed, false)).toBe(compressed);
  });
});
