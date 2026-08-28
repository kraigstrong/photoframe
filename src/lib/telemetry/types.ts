/**
 * Event shapes for the anonymous product telemetry used for this one-time
 * event. Ownership: `src/lib/telemetry/**`.
 *
 * Privacy invariant: NO field here may ever be derived from the guest's
 * photo — no filename, MIME type, dimensions, EXIF data, or hash of any
 * kind. Every event answers a product question about the flow (did the
 * guest reach this step, did this step succeed), never a question about the
 * photo's content.
 *
 * `err` fields carry a `DOMException.name` (a fixed, enumerable string like
 * `"AbortError"` or `"NotAllowedError"`) — never `.message`, which is
 * browser-authored free text that can vary and is not meant for this kind of
 * collection.
 */

/** Where the guest's photo came from. */
export type PhotoSource = 'camera' | 'library';

/** Coarse device/browser bucket. Approximate by design — see platform.ts. */
export type Platform =
  | 'ios-safari'
  | 'ios-other'
  | 'android-chrome'
  | 'android-other'
  | 'desktop-safari'
  | 'desktop-chrome'
  | 'desktop-other';

/** Result of an attempted native share. */
export type ExportOutcome = 'shared' | 'cancelled' | 'unavailable' | 'failed';

export type TelemetryEvent =
  /** Fires once per page load. Answers: how many sessions, on what platforms,
   * and does this browser support file sharing at all? */
  | { ev: 'app_open'; platform: Platform; canShareFiles: boolean }
  /** Fires when the guest taps "take photo" or "choose from library".
   * Answers: which entry point do guests prefer? */
  | { ev: 'source_click'; source: PhotoSource }
  /** Fires after a photo selection resolves (or fails to decode). `source` is
   * `null` when the browser reports a file without letting us know which
   * input produced it. Answers: how often does photo loading fail? */
  | { ev: 'photo_load'; source: PhotoSource | null; ok: boolean }
  /** Fires when the guest picks an overlay frame. Answers: which frame designs
   * are actually used? */
  | { ev: 'frame_select'; frame: string }
  /** Fires when the guest triggers an export, before the outcome is known.
   * Answers: how many guests attempt to finish, and via which path? */
  | { ev: 'export_attempt'; via: 'share' | 'download'; frame: string }
  /** Fires once the native share sheet interaction resolves. There is no
   * download-path counterpart because a triggered download has no
   * observable failure mode to report. Answers: does sharing actually
   * succeed for guests, or does it silently fail? */
  | { ev: 'export_result'; via: 'share'; outcome: ExportOutcome; frame: string; err?: string }
  /** Fires on an unrecoverable error in a critical path. Answers: is the app
   * breaking for guests in the wild? */
  | { ev: 'app_error'; kind: 'overlay_load' | 'export_build' };

/** The wire shape: one event plus the envelope fields added by track(). */
export type TelemetryEnvelope = TelemetryEvent & {
  /** Schema version, so a future incompatible change can be detected. */
  v: 1;
  /** Locally-generated persistent device id. See ids.ts. */
  did: string;
  /** Locally-generated per-tab-session id. See ids.ts. */
  sid: string;
  /** Monotonic per-session event counter, starting at 1. See ids.ts. */
  seq: number;
};
