import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportedImage } from '../image/types.ts';
import { shareService } from './service.ts';

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

type NavShare = {
  share?: ((data: { files: File[] }) => Promise<void>) | undefined;
  canShare?: ((data: { files: File[] }) => boolean) | undefined;
};

const originalShare = (navigator as NavShare).share;
const originalCanShare = (navigator as NavShare).canShare;

afterEach(() => {
  (navigator as NavShare).share = originalShare;
  (navigator as NavShare).canShare = originalCanShare;
});

describe('detect', () => {
  it("returns 'files' when navigator.share exists and canShare is not implemented", () => {
    (navigator as NavShare).share = vi.fn();
    delete (navigator as NavShare).canShare;
    expect(shareService.detect()).toBe('files');
  });

  it("returns 'files' when navigator.canShare({files}) returns true", () => {
    (navigator as NavShare).share = vi.fn();
    (navigator as NavShare).canShare = vi.fn().mockReturnValue(true);
    expect(shareService.detect()).toBe('files');
  });

  it("returns 'unavailable' when navigator.share does not exist", () => {
    delete (navigator as NavShare).share;
    expect(shareService.detect()).toBe('unavailable');
  });

  it("returns 'unavailable' when navigator.canShare({files}) returns false", () => {
    (navigator as NavShare).share = vi.fn();
    (navigator as NavShare).canShare = vi.fn().mockReturnValue(false);
    expect(shareService.detect()).toBe('unavailable');
  });

  it("returns 'unavailable' rather than throwing when navigator.canShare throws", () => {
    (navigator as NavShare).share = vi.fn();
    (navigator as NavShare).canShare = vi.fn().mockImplementation(() => {
      throw new Error('canShare exploded');
    });
    expect(shareService.detect()).toBe('unavailable');
  });

  it('never throws, even with a partially-implemented navigator', () => {
    delete (navigator as NavShare).share;
    delete (navigator as NavShare).canShare;
    expect(() => shareService.detect()).not.toThrow();
  });
});

describe('share', () => {
  it("returns 'unavailable' when navigator.share is unavailable", async () => {
    delete (navigator as NavShare).share;
    const outcome = await shareService.share(makeExportedImage());
    expect(outcome).toMatchObject({ result: 'unavailable' });
  });

  it("returns 'unavailable' when canShare rejects the file", async () => {
    (navigator as NavShare).share = vi.fn().mockResolvedValue(undefined);
    (navigator as NavShare).canShare = vi.fn().mockReturnValue(false);
    const outcome = await shareService.share(makeExportedImage());
    expect(outcome).toMatchObject({ result: 'unavailable' });
    expect((navigator as NavShare).share).not.toHaveBeenCalled();
  });

  it("returns 'shared' when navigator.share resolves", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    (navigator as NavShare).share = shareMock;
    (navigator as NavShare).canShare = vi.fn().mockReturnValue(true);

    const exported = makeExportedImage({ filename: 'my-event-42.jpg' });
    const outcome = await shareService.share(exported);

    expect(outcome).toEqual({ result: 'shared' });
    expect(shareMock).toHaveBeenCalledTimes(1);
    const call = shareMock.mock.calls[0]?.[0] as { files: File[] };
    expect(call.files).toHaveLength(1);
    expect(call.files[0]?.name).toBe('my-event-42.jpg');
    expect(call.files[0]?.type).toBe('image/jpeg');
  });

  it("returns 'cancelled', not 'failed', when the guest dismisses the share sheet", async () => {
    (navigator as NavShare).share = vi
      .fn()
      .mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    (navigator as NavShare).canShare = vi.fn().mockReturnValue(true);

    const outcome = await shareService.share(makeExportedImage());
    expect(outcome).toEqual({ result: 'cancelled' });
  });

  it("returns 'failed' with a reason for a genuine (non-cancellation) share error", async () => {
    (navigator as NavShare).share = vi.fn().mockRejectedValue(new Error('share broke'));
    (navigator as NavShare).canShare = vi.fn().mockReturnValue(true);

    const outcome = await shareService.share(makeExportedImage());
    expect(outcome).toMatchObject({ result: 'failed', reason: expect.stringContaining('broke') });
  });

  it('works when navigator.canShare is not implemented at all (only navigator.share)', async () => {
    (navigator as NavShare).share = vi.fn().mockResolvedValue(undefined);
    delete (navigator as NavShare).canShare;

    const outcome = await shareService.share(makeExportedImage());
    expect(outcome).toEqual({ result: 'shared' });
  });
});

describe('saveFallback', () => {
  let appendSpy: ReturnType<typeof vi.spyOn>;
  let removeSpy: ReturnType<typeof vi.spyOn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    appendSpy = vi.spyOn(document.body, 'appendChild');
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    removeSpy = vi.spyOn(HTMLAnchorElement.prototype, 'remove');
  });

  afterEach(() => {
    appendSpy.mockRestore();
    clickSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('creates a temporary download anchor with the correct href and filename, then removes it', () => {
    const exported = makeExportedImage({ objectUrl: 'blob:xyz', filename: 'our-event-7.jpg' });
    shareService.saveFallback(exported);

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);
    const anchor = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement;
    expect(anchor.tagName).toBe('A');
    expect(anchor.href).toContain('blob:xyz');
    expect(anchor.download).toBe('our-event-7.jpg');
  });
});
