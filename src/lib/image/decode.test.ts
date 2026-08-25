import { afterEach, describe, expect, it, vi } from 'vitest';
import { decode } from './decode.ts';

/**
 * decode() itself is exercised end-to-end only in Playwright (tests/e2e/
 * image-engine.spec.ts) because jsdom cannot fire real image load events.
 * These tests cover the two branches that reject *before* any real
 * decoding is attempted, which are fully structural and don't need it.
 */
describe('decode (structural, jsdom)', () => {
  it('rejects a file whose MIME type is not an image, without hanging', async () => {
    const file = new File(['this is not an image'], 'not-an-image.txt', { type: 'text/plain' });
    await expect(decode(file)).rejects.toThrow(/unsupported file type/i);
  });

  it('rejects a file with no type and a non-image extension', async () => {
    const file = new File(['plain text'], 'notes.md', { type: '' });
    await expect(decode(file)).rejects.toThrow(/unsupported file type/i);
  });

  it('rejects distinguishably as a cancellation when the signal is already aborted', async () => {
    const file = new File(['fake bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const controller = new AbortController();
    controller.abort();

    await expect(decode(file, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('propagates a custom abort reason instead of the generic AbortError when given one', async () => {
    const file = new File(['fake bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const controller = new AbortController();
    const reason = new Error('guest navigated away');
    controller.abort(reason);

    await expect(decode(file, { signal: controller.signal })).rejects.toBe(reason);
  });

  // jsdom has no createImageBitmap and its <img> never fires load/error
  // events (see FIXTURES.md), so if the unsupported-file-type check above
  // did not short-circuit *before* reaching real decoding, decodeSource's
  // <img> fallback would hang forever and the two tests above would time
  // out rather than resolve. Their passing is itself the proof the type
  // check runs first; real decoding is covered end-to-end in Playwright.
});

describe('decode (abort mid-flight, jsdom with a fake createImageBitmap)', () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;

  afterEach(() => {
    globalThis.createImageBitmap = originalCreateImageBitmap;
  });

  it('disposes the decoded bitmap if it resolves only after the caller already aborted', async () => {
    let resolveBitmap!: (bitmap: { width: number; height: number; close: () => void }) => void;
    const bitmapPromise = new Promise<{ width: number; height: number; close: () => void }>(
      (resolve) => {
        resolveBitmap = resolve;
      },
    );
    const close = vi.fn();
    // Test-only global shim so decodeViaImageBitmap's
    // `typeof createImageBitmap === 'function'` check takes this branch.
    globalThis.createImageBitmap = vi.fn(
      () => bitmapPromise,
    ) as unknown as typeof createImageBitmap;

    const file = new File(['fake bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const controller = new AbortController();

    const decodePromise = decode(file, { signal: controller.signal });
    controller.abort();
    await expect(decodePromise).rejects.toMatchObject({ name: 'AbortError' });

    expect(close).not.toHaveBeenCalled();

    // The fake "decode" only resolves now — well after decode() already
    // rejected because of the abort. Without disposing the lost race's
    // result, this bitmap would leak.
    resolveBitmap({ width: 10, height: 10, close });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
