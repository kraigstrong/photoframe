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
import type { TelemetryEnvelope, TelemetryEvent } from './types.ts';

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

    // Envelope fields are spread LAST so they always win: the wire shape's
    // `v`/`did`/`sid`/`seq` can never be shadowed by a future event variant
    // that happens to reuse one of those names.
    const envelope: TelemetryEnvelope = {
      ...event,
      v: 1,
      did: getDeviceId(),
      sid: getSessionId(),
      seq: nextSeq(),
    };
    const body = JSON.stringify(envelope);

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
