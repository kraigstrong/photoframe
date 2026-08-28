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
 */
import { getDeviceId, getSessionId, nextSeq } from './ids.ts';
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
 * Keep in sync with the server-side allowlist in the telemetry endpoint,
 * which enforces the same thing again on arrival.
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
    // Read the endpoint on every call, not at module scope: module-scope
    // capture cannot be stubbed in tests, and this keeps telemetry inert by
    // construction whenever the env var is unset — dev, unit tests, and
    // Playwright all run with it unset.
    const endpoint = import.meta.env.VITE_TELEMETRY_URL;
    if (!endpoint) {
      return;
    }
    // The endpoint must be SAME-ORIGIN (a relative path like `/api/e`).
    // `application/json` is not a CORS-safelisted content type, so a
    // cross-origin beacon would need a preflight that sendBeacon cannot
    // perform — it would fail silently and fall through to a fetch that
    // then needs CORS of its own. Same-origin skips all of that.

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

    const body = JSON.stringify(payload);

    const sentViaBeacon =
      typeof navigator.sendBeacon === 'function' &&
      navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));

    if (!sentViaBeacon) {
      fetch(endpoint, {
        method: 'POST',
        body,
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => {});
    }
  } catch {
    // Telemetry must never affect the guest flow.
  }
}
