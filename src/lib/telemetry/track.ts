/**
 * Fire-and-forget telemetry transport.
 *
 * Invariant: this function transmits ONLY the fields present on
 * `TelemetryEvent` (see types.ts), plus the locally-generated envelope ids.
 * Nothing derived from the guest's photo passes through it, ever.
 *
 * The whole body is wrapped in one try/catch that swallows everything.
 * `track()` returns `void`, never a promise, never throws, and must never be
 * awaited — a telemetry failure must be incapable of affecting the guest
 * flow.
 *
 * The actual transport (PostHog, lazy-loaded and locked down) lives in
 * `posthog.ts`; this module's only job is building the allowlisted payload.
 */
import { getDeviceId, getSessionId, nextSeq } from './ids.ts';
import { capture } from './posthog.ts';
import type { TelemetryEvent } from './types.ts';

/**
 * The exact fields transmitted for each event. See `TelemetryEnvelope` in
 * types.ts for the resulting wire shape.
 *
 * This is a RUNTIME allowlist, and that is the whole point. TypeScript only
 * excess-property-checks object *literals*: a caller that assembles an event
 * in a variable can carry extra properties, still satisfy `TelemetryEvent`,
 * and compile cleanly. A plain `...event` spread would then serialize those
 * extras — and one of them could one day be photo-derived (a filename, a
 * dimension, a hash). The payload is therefore built field by field from
 * this list, never from whatever the caller happens to hand over, so the
 * privacy invariant holds no matter what a future call site does.
 *
 * Keep in sync with `ALLOWED_EVENT_PROPERTIES` in `posthog.ts`, which
 * enforces an independent copy of this same allowlist again, right before
 * the request is actually built — see that file's module doc.
 */
const EVENT_FIELDS: Record<TelemetryEvent['ev'], readonly string[]> = {
  app_open: ['platform', 'canShareFiles'],
  source_click: ['source'],
  photo_load: ['source', 'ok'],
  frame_select: ['frame'],
  export_attempt: ['via', 'frame'],
  export_result: ['via', 'outcome', 'frame', 'err'],
  app_error: ['kind'],
};

export function track(event: TelemetryEvent): void {
  try {
    // Read the key on every call, not at module scope: module-scope capture
    // cannot be stubbed in tests, and this keeps telemetry inert by
    // construction whenever the env var is unset — dev, unit tests, and
    // Playwright all run with it unset. Checked here, before anything else,
    // so an inert build never even touches ids.ts (no device/session id is
    // minted or persisted, and nextSeq() never increments) — matching the
    // previous sendBeacon-based behavior exactly.
    if (!import.meta.env.VITE_POSTHOG_KEY) {
      return;
    }

    // Copy only allowlisted fields off the event; anything else the caller
    // attached is dropped here and never reaches the wire.
    const payload: Record<string, unknown> = {};
    const source = event as Record<string, unknown>;
    for (const field of EVENT_FIELDS[event.ev]) {
      const value = source[field];
      // Skipping `undefined` also keeps optional fields (`err`) absent
      // rather than serialized as null.
      if (value !== undefined) {
        payload[field] = value;
      }
    }

    // Envelope fields are assigned LAST so they always win: `ev`/`v`/`did`/
    // `sid`/`seq` can never be shadowed by an allowlisted event field.
    payload.ev = event.ev;
    payload.v = 1;
    payload.did = getDeviceId();
    payload.sid = getSessionId();
    payload.seq = nextSeq();

    capture(event.ev, payload);
  } catch {
    // Telemetry must never affect the guest flow.
  }
}
