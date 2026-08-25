/**
 * Interfaces owned by the orchestrator and implemented by the sharing module.
 *
 * Ownership: `src/lib/share/**`.
 */
import type { ExportedImage } from '../image/types.ts';

export type ShareCapability =
  /** `navigator.share` accepts files on this browser. */
  | 'files'
  /** Sharing is unavailable; the download fallback must be used. */
  | 'unavailable';

export type ShareOutcome =
  | { result: 'shared' }
  /** The guest dismissed the OS share sheet. Not an error. */
  | { result: 'cancelled' }
  /** Sharing failed; the caller should move to the fallback save path. */
  | { result: 'failed'; reason: string };

export interface ShareService {
  /** Feature-detects file sharing. Must not throw on any target browser. */
  detect(): ShareCapability;
  /** Opens the native share sheet with the finished image attached. */
  share(exported: ExportedImage): Promise<ShareOutcome>;
  /** Triggers the download/long-press fallback save path. */
  saveFallback(exported: ExportedImage): void;
}
