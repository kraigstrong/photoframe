import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageEngine } from '../lib/image/index.ts';
import type { ExportedImage, Transform, WorkingImage } from '../lib/image/types.ts';
import { useGuestFlow } from './useGuestFlow.ts';

vi.mock('../lib/image/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/image/index.ts')>();
  return {
    ...actual,
    imageEngine: {
      decode: vi.fn(),
      coverFit: vi.fn(),
      clamp: vi.fn(),
      export: vi.fn(),
    },
  };
});

const mockedEngine = vi.mocked(imageEngine);

/**
 * jsdom's real Image never fires load/error for any src (no resource
 * loader — see tests/fixtures/FIXTURES.md), so the overlay preload needs a
 * controllable fake for every test in this file.
 */
class FakeImage {
  src = '';
  private listeners: Record<string, Array<() => void>> = {};
  addEventListener(type: string, cb: () => void): void {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener(type: string, cb: () => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== cb);
  }
  fireLoad(): void {
    this.listeners.load?.slice().forEach((cb) => cb());
  }
  fireError(): void {
    this.listeners.error?.slice().forEach((cb) => cb());
  }
}

let createdImages: FakeImage[] = [];
const originalImage = globalThis.Image;

function latestImage(): FakeImage {
  const img = createdImages.at(-1);
  if (!img) {
    throw new Error('No Image() was constructed yet.');
  }
  return img;
}

/** Fires `load` on every overlay `Image()` the hook has constructed so far —
 * it decodes all configured overlays in parallel, not just one. */
async function loadOverlaySuccessfully(): Promise<void> {
  await act(async () => {
    createdImages.forEach((img) => img.fireLoad());
    await Promise.resolve();
  });
}

function makeWorkingImage(overrides: Partial<WorkingImage> = {}): WorkingImage {
  return {
    src: 'blob:working',
    width: 600,
    height: 800,
    release: vi.fn(),
    ...overrides,
  };
}

function makeExportedImage(overrides: Partial<ExportedImage> = {}): ExportedImage {
  return {
    blob: new Blob(['fake'], { type: 'image/jpeg' }),
    objectUrl: 'blob:exported',
    filename: 'event-1.jpg',
    width: 1080,
    height: 1350,
    release: vi.fn(),
    ...overrides,
  };
}

const BASELINE_TRANSFORM: Transform = { x: 0, y: 0, scale: 1 };

function setDocumentVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
}

beforeEach(() => {
  createdImages = [];
  // @ts-expect-error test-only global shim; see FakeImage above.
  globalThis.Image = vi.fn(function ImageConstructor() {
    const img = new FakeImage();
    createdImages.push(img);
    return img;
  });
  mockedEngine.decode.mockReset();
  mockedEngine.coverFit.mockReset().mockReturnValue(BASELINE_TRANSFORM);
  mockedEngine.clamp.mockReset();
  mockedEngine.export.mockReset();
});

afterEach(() => {
  globalThis.Image = originalImage;
  vi.restoreAllMocks();
});

describe('useGuestFlow: overlay preload', () => {
  it('starts with overlayReady false and flips true once the overlay image loads', async () => {
    const { result } = renderHook(() => useGuestFlow());
    expect(result.current.overlayReady).toBe(false);

    await loadOverlaySuccessfully();

    expect(result.current.overlayReady).toBe(true);
    expect(result.current.state.status).toBe('idle');
  });

  it('moves to an overlayLoadFailed error state if the overlay fails to decode', async () => {
    const { result } = renderHook(() => useGuestFlow());

    await act(async () => {
      latestImage().fireError();
      await Promise.resolve();
    });

    expect(result.current.state).toMatchObject({
      status: 'error',
      error: { kind: 'overlayLoadFailed', recoverable: true },
    });
  });
});

describe('useGuestFlow: select -> decode -> export', () => {
  it('goes idle -> decoding -> editing -> ready, and releases nothing along the happy path', async () => {
    const image = makeWorkingImage();
    const exported = makeExportedImage();
    mockedEngine.decode.mockResolvedValue(image);
    mockedEngine.export.mockResolvedValue(exported);

    const { result } = renderHook(() => useGuestFlow());
    await loadOverlaySuccessfully();

    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    act(() => {
      result.current.selectFile(file);
    });
    expect(result.current.state.status).toBe('decoding');

    await waitFor(() => expect(result.current.state.status).toBe('editing'));
    expect(result.current.state).toMatchObject({
      status: 'editing',
      image,
      transform: BASELINE_TRANSFORM,
    });

    await waitFor(() => expect(result.current.state.status).toBe('ready'), { timeout: 2000 });
    expect(result.current.state).toMatchObject({ status: 'ready', image, exported });

    expect(image.release).not.toHaveBeenCalled();
    expect(exported.release).not.toHaveBeenCalled();
  });

  it('releases the superseded WorkingImage when a second selection outruns the first decode', async () => {
    const firstImage = makeWorkingImage();
    const secondImage = makeWorkingImage();
    let resolveFirst!: (image: WorkingImage) => void;
    const firstDecode = new Promise<WorkingImage>((resolve) => {
      resolveFirst = resolve;
    });
    mockedEngine.decode
      .mockImplementationOnce(() => firstDecode)
      .mockImplementationOnce(() => Promise.resolve(secondImage));
    mockedEngine.export.mockImplementation(() => new Promise(() => {})); // never resolves; not under test here

    const { result } = renderHook(() => useGuestFlow());
    await loadOverlaySuccessfully();

    act(() => {
      result.current.selectFile(new File(['a'], 'a.jpg', { type: 'image/jpeg' }));
    });
    act(() => {
      result.current.selectFile(new File(['b'], 'b.jpg', { type: 'image/jpeg' }));
    });

    await waitFor(() => expect(result.current.state.status).toBe('editing'));
    expect(result.current.state).toMatchObject({ status: 'editing', image: secondImage });

    // The superseded decode finally resolves late — its result must be
    // released, not applied.
    await act(async () => {
      resolveFirst(firstImage);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(firstImage.release).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({ status: 'editing', image: secondImage });
  });

  it('maps a decode rejection to a recoverable decodeFailed error', async () => {
    mockedEngine.decode.mockRejectedValue(new Error('bad file'));

    const { result } = renderHook(() => useGuestFlow());
    await loadOverlaySuccessfully();

    act(() => {
      result.current.selectFile(new File(['x'], 'x.jpg', { type: 'image/jpeg' }));
    });

    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        status: 'error',
        error: { kind: 'decodeFailed', recoverable: true },
      }),
    );
  });
});

describe('useGuestFlow: editing transforms', () => {
  async function getToReady() {
    const image = makeWorkingImage();
    const firstExported = makeExportedImage({ objectUrl: 'blob:first' });
    mockedEngine.decode.mockResolvedValue(image);
    mockedEngine.export.mockResolvedValueOnce(firstExported);

    const hook = renderHook(() => useGuestFlow());
    await loadOverlaySuccessfully();
    act(() => {
      hook.result.current.selectFile(new File(['x'], 'x.jpg', { type: 'image/jpeg' }));
    });
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'), {
      timeout: 2000,
    });
    return { hook, image, firstExported };
  }

  it('updateTransform from ready releases the stale export and produces a fresh one', async () => {
    const { hook, image, firstExported } = await getToReady();
    const secondExported = makeExportedImage({ objectUrl: 'blob:second' });
    mockedEngine.export.mockResolvedValueOnce(secondExported);

    const nextTransform: Transform = { x: -10, y: -5, scale: 1.5 };
    act(() => {
      hook.result.current.updateTransform(nextTransform);
    });

    expect(firstExported.release).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state).toMatchObject({
      status: 'editing',
      transform: nextTransform,
    });

    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'), {
      timeout: 2000,
    });
    expect(hook.result.current.state).toMatchObject({
      status: 'ready',
      image,
      exported: secondExported,
    });
  });

  it('changePhoto releases the current image and export, and returns to idle', async () => {
    const { hook, image, firstExported } = await getToReady();

    act(() => {
      hook.result.current.changePhoto();
    });

    expect(image.release).toHaveBeenCalledTimes(1);
    expect(firstExported.release).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state).toMatchObject({ status: 'idle' });
  });
});

describe('useGuestFlow: export failure and retry', () => {
  it('exportFailed retry restores editing with the last known image/transform, without a fresh decode', async () => {
    const image = makeWorkingImage();
    mockedEngine.decode.mockResolvedValue(image);
    mockedEngine.export.mockResolvedValueOnce(makeExportedImage()); // first export succeeds
    mockedEngine.export.mockRejectedValueOnce(new Error('export exploded')); // triggered by the edit below

    const { result } = renderHook(() => useGuestFlow());
    await loadOverlaySuccessfully();
    act(() => {
      result.current.selectFile(new File(['x'], 'x.jpg', { type: 'image/jpeg' }));
    });
    await waitFor(() => expect(result.current.state.status).toBe('ready'), { timeout: 2000 });

    act(() => {
      result.current.updateTransform({ x: -1, y: -1, scale: 2 });
    });
    await waitFor(
      () =>
        expect(result.current.state).toMatchObject({
          status: 'error',
          error: { kind: 'exportFailed' },
        }),
      { timeout: 2000 },
    );

    expect(mockedEngine.decode).toHaveBeenCalledTimes(1);

    mockedEngine.export.mockResolvedValueOnce(makeExportedImage({ objectUrl: 'blob:recovered' }));
    act(() => {
      result.current.retry();
    });

    expect(result.current.state).toMatchObject({ status: 'editing', image });
    await waitFor(() => expect(result.current.state.status).toBe('ready'), { timeout: 2000 });
    // Still only the one decode call from the original selection — retry
    // recovered without asking the guest to reselect a photo.
    expect(mockedEngine.decode).toHaveBeenCalledTimes(1);
  });

  it('recovers without a reselect even when the very first export attempt fails (no prior successful export)', async () => {
    // Regression test: lastEditableRef used to be populated only inside a
    // *successful* export's callback, so if the first-ever export attempt
    // failed, retry had nothing to recover with and fell back to sending
    // the guest all the way to idle — silently orphaning the still-valid
    // WorkingImage (never released) in the process.
    const image = makeWorkingImage();
    mockedEngine.decode.mockResolvedValue(image);
    mockedEngine.export.mockRejectedValueOnce(new Error('export exploded'));

    const { result } = renderHook(() => useGuestFlow());
    await loadOverlaySuccessfully();
    act(() => {
      result.current.selectFile(new File(['x'], 'x.jpg', { type: 'image/jpeg' }));
    });
    await waitFor(
      () =>
        expect(result.current.state).toMatchObject({
          status: 'error',
          error: { kind: 'exportFailed' },
        }),
      { timeout: 2000 },
    );

    mockedEngine.export.mockResolvedValueOnce(makeExportedImage());
    act(() => {
      result.current.retry();
    });

    // Retries with the same decoded image, not a forced return to idle —
    // and never released it, so it's still the very same object.
    expect(result.current.state).toMatchObject({ status: 'editing', image });
    expect(image.release).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.state.status).toBe('ready'), { timeout: 2000 });
    expect(mockedEngine.decode).toHaveBeenCalledTimes(1);
  });
});

describe('useGuestFlow: sharing and fallback', () => {
  async function getToReady() {
    const image = makeWorkingImage();
    const exported = makeExportedImage();
    mockedEngine.decode.mockResolvedValue(image);
    mockedEngine.export.mockResolvedValue(exported);

    const hook = renderHook(() => useGuestFlow());
    await loadOverlaySuccessfully();
    act(() => {
      hook.result.current.selectFile(new File(['x'], 'x.jpg', { type: 'image/jpeg' }));
    });
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'), {
      timeout: 2000,
    });
    return { hook, image, exported };
  }

  it('ignores a second saveOrShare tap while the first share is still pending, so navigator.share is never called concurrently', async () => {
    // Regression test (adversarial review, milestone 4): the underlying
    // guard here is what actually prevents a double navigator.share() call
    // — EditingScreen's fixed re-enable timer is only a UI nicety on top
    // of it, not the thing that makes this safe.
    let resolveShare!: () => void;
    const shareMock = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveShare = resolve;
        }),
    );
    navigator.share = shareMock;
    navigator.canShare = () => true;

    const { hook } = await getToReady();
    act(() => {
      hook.result.current.saveOrShare();
    });
    act(() => {
      hook.result.current.saveOrShare();
    });

    expect(shareMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveShare();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Once the first share completes, a later tap is allowed through again.
    act(() => {
      hook.result.current.saveOrShare();
    });
    expect(shareMock).toHaveBeenCalledTimes(2);
  });

  it('falls back when the browser has no navigator.share', async () => {
    const originalShare = (navigator as { share?: unknown }).share;
    // @ts-expect-error simulating an unsupported browser
    delete navigator.share;

    const { hook, exported } = await getToReady();
    await act(async () => {
      hook.result.current.saveOrShare();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook.result.current.state).toMatchObject({ status: 'fallbackSave', exported });
    (navigator as { share?: unknown }).share = originalShare;
  });

  it('treats a cancelled share sheet as a normal outcome, staying in ready', async () => {
    const shareMock = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    navigator.share = shareMock;
    navigator.canShare = () => true;

    const { hook } = await getToReady();
    await act(async () => {
      hook.result.current.saveOrShare();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook.result.current.state.status).toBe('ready');
  });

  it('falls back to fallbackSave on a genuine (non-cancellation) share failure', async () => {
    const shareMock = vi.fn().mockRejectedValue(new Error('share broke'));
    navigator.share = shareMock;
    navigator.canShare = () => true;

    const { hook, exported } = await getToReady();
    await act(async () => {
      hook.result.current.saveOrShare();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook.result.current.state).toMatchObject({ status: 'fallbackSave', exported });
  });

  it('backToEditing from fallbackSave restores straight to ready with the still-valid export (no re-encode, no stuck "Preparing…")', async () => {
    const originalShare = (navigator as { share?: unknown }).share;
    // @ts-expect-error simulating an unsupported browser
    delete navigator.share;

    const { hook, image, exported } = await getToReady();
    await act(async () => {
      hook.result.current.saveOrShare();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.result.current.state.status).toBe('fallbackSave');

    act(() => {
      hook.result.current.backToEditing();
    });
    // Immediately 'ready' (Save/Share enabled), not 'editing' — the crop
    // didn't change, so there's nothing to re-export.
    expect(hook.result.current.state).toMatchObject({ status: 'ready', image, exported });
    expect(exported.release).not.toHaveBeenCalled();

    (navigator as { share?: unknown }).share = originalShare;
  });

  it('saveOrShare works immediately after backToEditing, without the guest touching the transform', async () => {
    // Regression test: backToEditing used to restore 'editing' without ever
    // scheduling a new export, leaving Save/Share disabled forever unless
    // the guest happened to drag or use the zoom slider afterward.
    const shareMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('share broke'))
      .mockResolvedValue(undefined);
    navigator.share = shareMock;
    navigator.canShare = () => true;

    const { hook } = await getToReady();
    act(() => {
      hook.result.current.saveOrShare();
    });
    await waitFor(() => expect(hook.result.current.state.status).toBe('fallbackSave'));
    expect(shareMock).toHaveBeenCalledTimes(1);

    act(() => {
      hook.result.current.backToEditing();
    });
    expect(hook.result.current.state.status).toBe('ready');

    act(() => {
      hook.result.current.saveOrShare();
    });
    expect(shareMock).toHaveBeenCalledTimes(2);
  });

  it('download() creates and clicks a temporary anchor pointing at the exported object URL', async () => {
    const originalShare = (navigator as { share?: unknown }).share;
    // @ts-expect-error simulating an unsupported browser
    delete navigator.share;

    const { hook, exported } = await getToReady();
    await act(async () => {
      hook.result.current.saveOrShare();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.result.current.state.status).toBe('fallbackSave');

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    act(() => {
      hook.result.current.download();
    });

    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
    (navigator as { share?: unknown }).share = originalShare;
    void exported;
  });

  it("sets confirmation to 'done' after a successful share, then clears it on its own", async () => {
    navigator.share = vi.fn().mockResolvedValue(undefined);
    navigator.canShare = () => true;

    const { hook } = await getToReady();
    vi.useFakeTimers();
    expect(hook.result.current.confirmation).toBeNull();

    await act(async () => {
      hook.result.current.saveOrShare();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.result.current.confirmation).toBe('done');

    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(hook.result.current.confirmation).toBeNull();

    vi.useRealTimers();
  });

  it("sets confirmation to 'done' after download()", async () => {
    const originalShare = (navigator as { share?: unknown }).share;
    // @ts-expect-error simulating an unsupported browser, forcing fallbackSave
    delete navigator.share;

    const { hook } = await getToReady();
    vi.useFakeTimers();
    await act(async () => {
      hook.result.current.saveOrShare();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.result.current.state.status).toBe('fallbackSave');
    expect(hook.result.current.confirmation).toBeNull();

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    act(() => {
      hook.result.current.download();
    });
    expect(hook.result.current.confirmation).toBe('done');

    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(hook.result.current.confirmation).toBeNull();

    clickSpy.mockRestore();
    (navigator as { share?: unknown }).share = originalShare;
    vi.useRealTimers();
  });

  it('does not set any confirmation when the guest cancels the share sheet', async () => {
    navigator.share = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    navigator.canShare = () => true;

    const { hook } = await getToReady();
    await act(async () => {
      hook.result.current.saveOrShare();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook.result.current.state.status).toBe('ready');
    expect(hook.result.current.confirmation).toBeNull();
  });

  afterEach(() => {
    setDocumentVisibility('visible');
  });

  it(
    'does not show the confirmation while the page is hidden behind the native share sheet — only ' +
      'once the guest actually returns to it',
    async () => {
      // Regression test: navigator.share() resolves at hand-off time (e.g.
      // once Messages' compose screen appears), while this page is still
      // hidden behind it. Showing the confirmation immediately would run
      // its whole auto-dismiss clock before the guest could ever see it.
      navigator.share = vi.fn().mockResolvedValue(undefined);
      navigator.canShare = () => true;

      const { hook } = await getToReady();
      setDocumentVisibility('hidden');

      await act(async () => {
        hook.result.current.saveOrShare();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(hook.result.current.confirmation).toBeNull();

      setDocumentVisibility('visible');
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(hook.result.current.confirmation).toBe('done');
    },
  );

  it('shows the confirmation immediately when the page never left visibility (e.g. a fast/local share target)', async () => {
    navigator.share = vi.fn().mockResolvedValue(undefined);
    navigator.canShare = () => true;

    const { hook } = await getToReady();
    setDocumentVisibility('visible');

    await act(async () => {
      hook.result.current.saveOrShare();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.result.current.confirmation).toBe('done');
  });

  it('does not show the confirmation until the page becomes visible again after download()', async () => {
    const originalShare = (navigator as { share?: unknown }).share;
    // @ts-expect-error simulating an unsupported browser, forcing fallbackSave
    delete navigator.share;

    const { hook } = await getToReady();
    await act(async () => {
      hook.result.current.saveOrShare();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.result.current.state.status).toBe('fallbackSave');

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    setDocumentVisibility('hidden');
    act(() => {
      hook.result.current.download();
    });
    expect(hook.result.current.confirmation).toBeNull();

    setDocumentVisibility('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(hook.result.current.confirmation).toBe('done');

    clickSpy.mockRestore();
    (navigator as { share?: unknown }).share = originalShare;
  });
});
