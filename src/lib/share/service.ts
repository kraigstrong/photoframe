/**
 * Implements the frozen `ShareService` interface (types.ts): Web Share API
 * capability detection, a file-only native share attempt, and the manual
 * download fallback.
 */
import type { ExportedImage } from '../image/types.ts';
import type { ShareCapability, ShareOutcome, ShareService } from './types.ts';

type NavigatorWithShare = Navigator & {
  canShare?: (data: { files: File[] }) => boolean;
  share?: (data: { files: File[] }) => Promise<void>;
};

function exportedImageToFile(exported: ExportedImage): File {
  return new File([exported.blob], exported.filename, { type: exported.blob.type });
}

/** Feature-detects file sharing. Must not throw on any target browser. */
function detect(): ShareCapability {
  const nav = navigator as NavigatorWithShare;
  return typeof nav.share === 'function' ? 'files' : 'unavailable';
}

/**
 * Opens the native share sheet with the finished image attached, from
 * directly within the caller's user-activation event handler — this must
 * not be awaited behind other async work first, or some browsers silently
 * refuse to open the share sheet.
 */
async function share(exported: ExportedImage): Promise<ShareOutcome> {
  const nav = navigator as NavigatorWithShare;
  if (typeof nav.share !== 'function') {
    return { result: 'failed', reason: 'Web Share API is unavailable in this browser.' };
  }

  const file = exportedImageToFile(exported);
  if (typeof nav.canShare === 'function' && !nav.canShare({ files: [file] })) {
    return { result: 'failed', reason: 'This browser cannot share image files.' };
  }

  try {
    await nav.share({ files: [file] });
    return { result: 'shared' };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // The guest dismissed the OS share sheet — a normal outcome.
      return { result: 'cancelled' };
    }
    return { result: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Triggers the download/long-press fallback save path. */
function saveFallback(exported: ExportedImage): void {
  const link = document.createElement('a');
  link.href = exported.objectUrl;
  link.download = exported.filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export const shareService: ShareService = { detect, share, saveFallback };
