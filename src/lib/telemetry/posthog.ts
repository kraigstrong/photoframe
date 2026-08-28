/**
 * PostHog transport: lazy-loaded, queued, and locked down.
 *
 * Ownership: this module is the ONLY place that talks to the `posthog-js`
 * library. `track.ts` never imports it directly.
 *
 * ## Load-bearing privacy configuration
 *
 * Every flag set in `buildConfig` below exists because PostHog's *defaults*
 * would violate a stated privacy requirement of this project (see
 * `README.md`'s "Privacy invariants" section and `src/lib/telemetry/types.ts`).
 * This is not a style preference and nobody should "clean up" or trim this
 * config later without re-reading why each line exists:
 *
 * - `autocapture: false`, `capture_pageview: false`, `capture_pageleave: false`,
 *   `capture_dead_clicks: false`, `capture_exceptions: false`,
 *   `capture_performance: false` — PostHog's defaults autocapture clicks,
 *   form submissions, page navigation, dead clicks, exceptions, and Web
 *   Vitals. This project sends exactly seven hand-picked, allowlisted events
 *   (see `types.ts`) and nothing else, ever.
 * - `disable_session_recording: true` — session replay is explicitly
 *   forbidden in this project. PostHog session replay would visually record
 *   the guest's screen, which could include the guest's own photo.
 * - `disable_surveys: true`, `disable_product_tours: true`,
 *   `disable_conversations: true` — these are PostHog features that can
 *   inject their OWN UI (survey popups, tour banners, a chat widget) into
 *   the page, driven by remote dashboard configuration rather than this
 *   codebase. A guest's screen must never show anything this app didn't
 *   render on purpose, so all three are hard-disabled client-side rather
 *   than left to "whatever the dashboard happens to be configured with
 *   today."
 * - `capture_heatmaps: false` — heatmaps record where on the page guests
 *   click/tap, aggregated over the DOM. Not part of this project's seven
 *   events.
 * - `persistence: 'localStorage'` — no cookies. This app has no cookie
 *   banner and must not need one.
 * - `person_profiles: 'never'` — events only, no PostHog "Person" records.
 *   This app never calls `identify()` (there is no login), so there is no
 *   anonymous-to-identified merge to preserve; funnel analysis across this
 *   app's own event sequence (app_open -> ... -> export_result) still works
 *   from the shared `distinct_id` (our own device id, see `bootstrap` below)
 *   without person profiles existing at all.
 * - `property_denylist` — a first-pass filter PostHog applies to the fully
 *   assembled property set (denylisted keys are deleted) before the event is
 *   sent. Covers IP, URL/referrer, screen/viewport size, raw user agent, and
 *   browser/OS/device/timezone/locale detail — all fingerprinting-adjacent
 *   data in the same spirit as `platform.ts`'s deliberately coarse ~7-bucket
 *   detection.
 * - `before_send` (see `sanitizeProperties`) — the FINAL clamp, run
 *   immediately before the request is built. Strips every property that
 *   isn't on this app's own `EVENT_FIELDS`/envelope allowlist (see
 *   `track.ts`) or the small set of `$`-prefixed properties PostHog needs to
 *   function (see below). This is deliberately a second, independent layer
 *   on top of `property_denylist`: if a future PostHog version changes what
 *   it auto-attaches, or `property_denylist` is ever trimmed by mistake,
 *   this allowlist still holds the line.
 *
 *   NOTE: the config option literally named `sanitize_properties` was NOT
 *   used for this, even though it exists in the installed version and
 *   matches this description closely. It is deprecated in favor of
 *   `before_send`, and — verified against `node_modules/posthog-js/dist/module.js`
 *   — using it logs a `console.error` on EVERY captured event in production.
 *   That is exactly the kind of guest-visible artifact this project avoids,
 *   so `before_send` is used instead; it has no such side effect and is
 *   applied at an equivalent (in fact later) point in the send pipeline.
 * - `bootstrap: { distinctID: getDeviceId() }` — uses this project's own
 *   auditable, locally-generated device id (see `ids.ts`) as PostHog's
 *   `distinct_id`, instead of letting PostHog mint and persist its own.
 * - `$geoip_disable: true` (registered as a super property right after
 *   `init()`, not inside its `loaded` callback — that callback only fires
 *   once PostHog's async remote-config round trip completes, which would
 *   leave any event captured before then without this property) —
 *   tells PostHog's ingestion pipeline not to resolve a location from the
 *   request IP for these events.
 *
 * See the bottom of this file for what could NOT be locked down from this
 * codebase, and why.
 */
import type { CaptureResult, PostHog, PostHogConfig, Properties } from 'posthog-js';
import { getDeviceId } from './ids.ts';

/** Sent as `$ip` on every event so PostHog never records the guest's real
 * address. See `sanitizeProperties`. */
const DISCARDED_IP = '0.0.0.0';

/** Caps the pre-load buffer so a load that never completes (or never even
 * starts, e.g. no network) cannot grow memory usage without bound. */
const MAX_QUEUE_SIZE = 50;

/**
 * The complete set of event-specific + envelope properties `track.ts` ever
 * places on a payload. Mirrors `EVENT_FIELDS`'s value union in `track.ts`
 * plus the envelope fields it always adds, kept as an independent literal
 * (not imported) so a bug in track.ts's own allowlist can't also disable
 * this second, independent layer.
 */
const ALLOWED_EVENT_PROPERTIES = new Set([
  'ev',
  'v',
  'did',
  'sid',
  'seq',
  'platform',
  'canShareFiles',
  'source',
  'ok',
  'frame',
  'via',
  'outcome',
  'err',
  'kind',
]);

/**
 * The minimum set of `$`-prefixed properties PostHog needs to keep working
 * correctly, determined by reading `node_modules/posthog-js/dist/module.js`
 * rather than guessed:
 *
 * - `$lib` / `$lib_version` — identify the sending SDK. No user data.
 * - `$insert_id` — a client-generated random string (not derived from the
 *   device/browser/network) used to deduplicate an event if the same
 *   request is retried. Guests at this event are explicitly expected to be
 *   on unreliable Wi-Fi (see README's "Known tradeoff" section), so retries
 *   are a real, not theoretical, case — dropping this would risk duplicate
 *   events on a flaky connection.
 * - `$time` — the client-side event timestamp. Kept for the same reason as
 *   `$insert_id`: under poor connectivity, the gap between "event happened"
 *   and "PostHog's server received the request" can be large enough to
 *   visibly skew event ordering/analysis if only server receive time is
 *   available.
 * - `$geoip_disable` — not something PostHog attaches on its own; this app
 *   registers it as a super property right after `init()` (see
 *   `loadPostHog` below) specifically so it reaches the server and
 *   suppresses IP-based geolocation. It must survive this clamp to have any
 *   effect.
 */
const REQUIRED_POSTHOG_PROPERTIES = new Set([
  // CRITICAL. Verified empirically against the real library (see
  // posthog.integration.test.ts): posthog-js carries BOTH of these inside
  // `properties`, not as top-level fields on CaptureResult — so a
  // properties allowlist silently removes them.
  //
  // - `distinct_id` is the ONLY thing tying a session's events to a device.
  //   Stripping it does not error, does not fail ingestion, and does not
  //   show up in any mocked test — it just makes every funnel, the
  //   unique-device count, and the whole photo-source comparison
  //   unanswerable, which we would not discover until after the event when
  //   the data is worthless. It carries our own locally-generated device id
  //   via `bootstrap` (see ids.ts), so allowing it transmits nothing beyond
  //   the `did` we already send.
  // - `token` identifies the project to the ingestion endpoint.
  'distinct_id',
  'token',
]);

const ALLOWED_DOLLAR_PROPERTIES = new Set([
  '$lib',
  '$lib_version',
  '$insert_id',
  '$time',
  '$geoip_disable',
  // Server-side enforcement of `person_profiles: 'never'`. This flag is how
  // the client tells ingestion not to create a Person record; stripping it
  // would leave that setting client-side only and could let person profiles
  // be created after all. It is a privacy control, not telemetry.
  '$process_person_profile',
]);

/**
 * Drops every property that isn't explicitly allowed. Exported for direct
 * unit testing; used as the `before_send` implementation below.
 */
export function sanitizeProperties(properties: Properties): Properties {
  const clean: Properties = {};
  for (const key of Object.keys(properties)) {
    if (
      ALLOWED_EVENT_PROPERTIES.has(key) ||
      ALLOWED_DOLLAR_PROPERTIES.has(key) ||
      REQUIRED_POSTHOG_PROPERTIES.has(key)
    ) {
      clean[key] = properties[key];
    }
  }
  // Force, never pass through. PostHog's ingestion takes the IP from
  // `properties.$ip` when present and only falls back to the request's
  // source address otherwise — and that source address is the guest's:
  // the /ingest reverse proxy (vercel.json) forwards `x-forwarded-for`,
  // and a Vercel rewrite cannot strip a request header. So without this
  // line an ordinary configured deployment persists guest IP addresses
  // while describing itself as anonymous.
  //
  // `$geoip_disable` alone is not enough — it suppresses turning the IP
  // into a location, not storing the IP.
  //
  // Assigned unconditionally rather than allowlisted so that a future SDK
  // version which starts attaching a real client-side $ip is overwritten
  // rather than forwarded. `before_send` is the last step before the
  // request is built, so this wins over `property_denylist` and over
  // anything PostHog assembled earlier.
  clean.$ip = DISCARDED_IP;
  return clean;
}

function beforeSend(result: CaptureResult | null): CaptureResult | null {
  if (!result) {
    return result;
  }
  return { ...result, properties: sanitizeProperties(result.properties ?? {}) };
}

function buildConfig(): Partial<PostHogConfig> {
  return {
    // Reverse-proxied through our own origin (see vercel.json) so the
    // browser never talks to a posthog.com host directly — this is what
    // defeats content blockers that would otherwise silently drop a chunk
    // of the funnel, and what keeps the network tab same-origin.
    api_host: import.meta.env.VITE_POSTHOG_HOST || '/ingest',
    // The real PostHog app URL, so any dashboard links PostHog renders
    // still resolve, even though api_host is our own proxied origin.
    ui_host: 'https://us.posthog.com',

    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    capture_exceptions: false,
    capture_performance: false,

    persistence: 'localStorage',
    person_profiles: 'never',

    property_denylist: [
      // Required, named explicitly in this project's telemetry spec.
      '$ip',
      '$current_url',
      '$referrer',
      '$referring_domain',
      '$initial_referrer',
      '$initial_referring_domain',
      '$screen_height',
      '$screen_width',
      '$viewport_height',
      '$viewport_width',
      '$raw_user_agent',
      '$pathname',
      '$host',
      // Same fingerprinting-adjacent character as the above, found while
      // reading posthog-config.d.ts: fine-grained browser/OS/device/locale
      // detection this project deliberately avoids (see platform.ts) and
      // additional URL-shaped properties in the same family as $current_url.
      '$browser',
      '$browser_version',
      '$browser_language',
      '$browser_language_prefix',
      '$browser_type',
      '$os',
      '$os_version',
      '$device',
      '$device_model',
      '$device_type',
      '$timezone',
      '$timezone_offset',
      '$search_engine',
      '$initial_current_url',
      '$session_entry_url',
      '$external_click_url',
    ],
    before_send: beforeSend,

    bootstrap: { distinctID: getDeviceId() },
  };
}

type QueuedCapture = { name: string; properties: Record<string, unknown> };

let queue: QueuedCapture[] = [];
let loadStarted = false;
let loadFailed = false;
let posthogInstance: PostHog | undefined;

function drainQueue(instance: PostHog): void {
  const pending = queue;
  queue = [];
  for (const item of pending) {
    instance.capture(item.name, item.properties);
  }
}

async function loadPostHog(apiKey: string): Promise<void> {
  try {
    const { default: posthog } = await import('posthog-js');
    posthog.init(apiKey, buildConfig());
    // See the module JSDoc: registered here (synchronously, right after
    // init) rather than in the `loaded` config callback, so it's in place
    // before any queued event drains below.
    posthog.register({ $geoip_disable: true });
    posthogInstance = posthog;
    drainQueue(posthog);
  } catch {
    // Never retry: a guest on bad Wi-Fi who fails once should not keep
    // re-attempting a ~60KB download in the background. Drop whatever was
    // queued and stay silent for the rest of the session.
    queue = [];
    loadFailed = true;
  }
}

/**
 * Queues (or immediately forwards) one event for PostHog. Synchronous,
 * never throws — mirrors `track()`'s own contract, since `track.ts` calls
 * this from inside its own try/catch but a defensive caller elsewhere
 * should never be able to observe a telemetry failure either.
 */
export function capture(name: string, properties: Record<string, unknown>): void {
  const apiKey = import.meta.env.VITE_POSTHOG_KEY;
  if (!apiKey || loadFailed) {
    return;
  }

  if (posthogInstance) {
    posthogInstance.capture(name, properties);
    return;
  }

  if (queue.length < MAX_QUEUE_SIZE) {
    queue.push({ name, properties });
  }

  if (!loadStarted) {
    loadStarted = true;
    void loadPostHog(apiKey);
  }
}

/**
 * ## What could not be locked down from this codebase
 *
 * "Set `$ip` to null" (from this project's telemetry spec) has no working
 * client-side equivalent in the installed `posthog-js` version. Confirmed
 * two ways: (1) the literal string `$ip` does not appear anywhere in
 * `node_modules/posthog-js/dist/module.js` — the browser SDK never attaches
 * an `$ip` property itself, client-side, at all; (2) `PostHogConfig`'s `ip`
 * field is explicitly deprecated with the doc comment "THIS OPTION HAS NO
 * EFFECT AT ALL... Use a custom transformation or 'Discard IP data' project
 * setting instead." IP address capture happens server-side, from the
 * ingestion request's source IP, which for this app is whatever IP the
 * `/ingest` reverse proxy (vercel.json) forwards — not something this
 * codebase's JavaScript can override. `$geoip_disable: true` (registered
 * above) suppresses location resolution FROM that IP, but does not stop the
 * IP itself from being recorded server-side. Fully discarding it requires
 * enabling "Discard IP data" in the PostHog project's dashboard settings —
 * an operational step outside this repository. `$ip` is included in
 * `property_denylist` above as defense-in-depth regardless, in case a future
 * SDK version starts sending it client-side.
 */
