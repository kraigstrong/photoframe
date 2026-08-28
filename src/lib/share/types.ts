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
  /** This browser cannot share files at all. Not an error — use the
   *  download fallback. Distinguished from `failed` so post-event
   *  reliability analysis can tell "never going to work here" apart from
   *  "broke unexpectedly". */
  | { result: 'unavailable'; reason: string }
  /** Sharing was attempted (the browser claims to support it) but
   *  `navigator.share()` itself threw for a reason other than the guest
   *  cancelling; the caller should move to the fallback save path.
   *
   *  `reason` is browser-authored free text (an `Error#message`) meant for
   *  human debugging only and must NEVER be transmitted anywhere off the
   *  device. `errorName` is the telemetry-safe counterpart: a
   *  `DOMException`/`Error` `.name`, drawn from a small, enumerable set
   *  (e.g. `"NotAllowedError"`, `"Error"`) — use that field for anything
   *  that leaves the device. */
  | { result: 'failed'; reason: string; errorName: string };

export interface ShareService {
  /** Feature-detects file sharing. Must not throw on any target browser. */
  detect(): ShareCapability;
  /** Opens the native share sheet with the finished image attached. */
  share(exported: ExportedImage): Promise<ShareOutcome>;
  /** Triggers the download/long-press fallback save path. */
  saveFallback(exported: ExportedImage): void;
}
