# Event Photo Frame

A mobile-first web app that lets an event guest scan a QR code, pick or take a photo, position it
under a transparent event overlay, and share the finished image.

**The photo never leaves the device.** All decoding, cropping, compositing, and encoding happen in
the browser. There is no upload, no backend, no database, and no account. A small set of anonymous
interaction events (e.g. "a photo was chosen," "the frame was changed," "the share sheet failed")
goes to PostHog through a same-origin reverse proxy — see [Privacy invariants](#privacy-invariants)
below for exactly what that is and isn't.

## Quick start

```bash
npm install
npm run dev
```

## Commands

| Command                                    | Purpose                                                       |
| ------------------------------------------ | ------------------------------------------------------------- |
| `npm run dev`                              | Local dev server                                              |
| `npm run build`                            | Type check and produce the static production build in `dist/` |
| `npm run preview`                          | Serve the production build locally                            |
| `npm run typecheck`                        | Strict TypeScript check                                       |
| `npm run lint`                             | Lint; fails on any warning                                    |
| `npm run format`                           | Format with Prettier                                          |
| `npm run format:check`                     | Verify formatting                                             |
| `npm test`                                 | Unit and component tests                                      |
| `npm run test:e2e`                         | Browser tests (Playwright) — builds first automatically       |
| `npm run generate:qr -- --url <https-url>` | Generate printable QR codes into `qr/`                        |

## Configuring the event

All event-specific values live in [`src/config/event.ts`](src/config/event.ts), typed by
[`src/config/types.ts`](src/config/types.ts). Edit that one file to change the event name, page
title, privacy copy, output dimensions, JPEG quality, filename prefix, camera facing hint, and
theme colors. Do not duplicate these values in components.

One deployment serves exactly one configured event.

## Replacing the overlay(s)

`src/assets/overlay-placeholder.png` is a **clearly labeled development placeholder**. It is not
production artwork. `eventConfig.overlays` in `src/config/event.ts` is a list of one or more frame
designs — the guest can only choose between them on the editing screen when the list has more than
one entry; with a single entry, editing looks exactly as it did before this feature. To use real
event frames:

1. Export each overlay as a **PNG with a real alpha channel** at exactly **1080 × 1350** — it must
   match `outputWidth` × `outputHeight` in `src/config/event.ts`. If you change the output size,
   change both together.
2. Make every area that should reveal the guest's photo **fully transparent**. Semi-transparent
   pixels composite over the photo and are allowed, but flattened white or black backgrounds will
   hide the photo entirely.
3. Keep logos, text, and sponsor marks inside a safe area roughly 5% in from each edge so nothing
   is lost if the frame is printed or cropped downstream.
4. Export a matching **square thumbnail** for each design (used on the editing-screen picker
   button instead of the full-size overlay, which is mostly transparent and unrecognizable at tap
   size) — a few hundred pixels per side is plenty.
5. Save each file into `src/assets/` and list it as an entry (`{ id, label, asset, thumbnail }`)
   in `eventConfig.overlays`. `label` is the accessible name shown for that option in the
   editing-screen picker (e.g. `"Design 1"`). Importing through `src/assets/` (rather than
   `public/`) is required: Vite gives each file a hashed filename, so a replaced overlay is never
   served from a stale cache.
6. Run `npm run build` and confirm every overlay is present in `dist/assets/` and that the total
   transfer stays within the ~2 MB budget.

`eventConfig.previewPhoto` is a separate, decorative sample photo (a real photo, not a transparent
overlay) shown in the landing-screen preview frame — same import-through-`src/assets/` rule
applies. Keep it compressed (a JPEG well under 500 KB is plenty); it's only ever displayed a few
hundred pixels wide.

All configured overlays are loaded and decoded before editing is enabled (every overlay must
decode successfully, same as the single-overlay case before), each always renders at full output
bounds, and none ever pans or zooms with the photo.

## QR code

Generate the QR only after the canonical production URL is live over HTTPS:

```bash
npm run generate:qr -- --url https://your-event-url
```

This writes `qr/event-qr.svg` (use this for print) and `qr/event-qr.png`. The `qr/` directory is
git-ignored — regenerate it rather than committing it. HTTP URLs are rejected unless you pass
`--allow-insecure`, which is for local testing only and must never be printed.

Test the printed QR at its actual intended size and contrast before the event.

## Deployment

Static Vite output deployed to Vercel. No server runtime, no serverless functions. See
[`vercel.json`](vercel.json).

1. Connect this repository to a Vercel project (framework preset: Vite; build command and output
   directory are already set in `vercel.json`).
2. Deploy. Vercel serves the production build over HTTPS automatically.
3. Confirm the deployed URL loads and that reloading the page (not just the initial load) works.
4. That URL — the stable production domain, not a preview-deployment URL — is the canonical URL.
   Generate the QR from it (see [QR code](#qr-code) above) only once it's final.

### Telemetry configuration (required before the event)

Telemetry is inert unless `VITE_POSTHOG_KEY` is set, so a deployment without it collects
nothing. If you do set it, **all three of these are required**, not optional:

- [ ] Set `VITE_POSTHOG_KEY` on **Production and Preview** (Preview too — the device-testing
      pass runs against a preview URL). The PostHog project API key is publishable by design;
      it is not a secret.
- [ ] In PostHog project settings, enable **"Discard IP data"**. The app already forces
      `$ip` to `0.0.0.0` on every event (see `sanitizeProperties` in
      `src/lib/telemetry/posthog.ts`), which is what actually stops the guest's address being
      recorded — the `/ingest` reverse proxy forwards `x-forwarded-for` and a Vercel rewrite
      cannot strip a request header. This setting is the second, server-side layer in case
      that client-side one is ever weakened.
- [ ] In PostHog project settings, confirm **session replay is disabled**. The client sets
      `disable_session_recording: true`, but replay would record a screen showing a guest's
      photo, so it is worth confirming at the project level too.

Verify after deploying: open the production URL, complete one full flow, and confirm in
PostHog that the events arrived with no `$current_url`, no `$raw_user_agent`, and
`$ip` showing `0.0.0.0`.

After the event, see [`docs/telemetry-analysis.md`](docs/telemetry-analysis.md) for how to
turn the seven events into the funnels and rates this was set up to answer — including the
caveats that must be reported alongside the numbers.

## Architecture

| Path                | Ownership                                                  |
| ------------------- | ---------------------------------------------------------- |
| `src/config/**`     | Typed event configuration                                  |
| `src/state/**`      | Explicit guest-flow state model                            |
| `src/lib/image/**`  | Decode, geometry, clamping, compositing, export            |
| `src/lib/share/**`  | Share capability detection, share sheet, download fallback |
| `src/components/**` | Guest-facing states and accessible controls                |
| `src/assets/**`     | Same-origin overlay asset                                  |
| `scripts/**`        | QR generation                                              |
| `tests/**`          | Shared setup and deterministic fixtures                    |

Image math, browser side effects, and React presentation are kept separate so each can be tested
directly.

## Privacy invariants

These are product requirements, not preferences. Do not break them:

- The selected photo and the generated image are never sent to `fetch`, XHR, a form action, a
  service worker, analytics, or error monitoring — not as a file, not as a data URL, not as EXIF,
  not as a filename or dimensions. Nothing derived from the photo leaves the device, ever.
- Neither is persisted to `localStorage`, IndexedDB, or Cache Storage.
- The app loads Google Fonts (see `index.html`) and, when configured, PostHog's analytics library —
  these are the only third-party origins involved, and are the only exceptions to same-origin
  loading. There are no other third-party scripts, fonts, or asset CDNs.

### Telemetry

`src/lib/telemetry/**` sends a small, fixed set of anonymous product-usage events — see the seven
variants of `TelemetryEvent` in `src/lib/telemetry/types.ts` for the exhaustive list (e.g.
"a source button was pressed," "a frame was selected," "the share sheet resolved as cancelled").
Each event is built field-by-field from a per-event allowlist (`EVENT_FIELDS` in `track.ts`) —
never a spread of whatever a call site happens to have on hand — so a future call site cannot
accidentally smuggle something new onto the wire.

- **Off by default.** Telemetry is gated on the `VITE_POSTHOG_KEY` build-time env var. Unset (the
  default in dev, unit tests, and CI), `track()` is a complete no-op: no network request, no
  PostHog library load, not even a locally-generated id is minted.
- **Same-origin transport.** Events go to PostHog through a same-origin reverse proxy (`/ingest`,
  see `vercel.json`) rather than directly to a posthog.com host, and the `posthog-js` library
  itself is lazy-loaded on first use so it never delays first paint.
- **Locked down.** `src/lib/telemetry/posthog.ts` disables autocapture, pageview/pageleave
  tracking, session replay, heatmaps, surveys, product tours, the in-app chat widget, dead-click
  and exception autocapture, and Web Vitals — all on by default in PostHog, all off here. See that
  file's module doc for the full rationale and an explicit list of what could **not** be locked
  down from application code (IP address handling, in particular).
- **Deliberately NOT collected:** the photo or generated image in any form; the guest's IP-derived
  location; raw user agent string; exact browser/OS/device model; screen or viewport dimensions;
  page URL, referrer, or any query parameter; session replay/screen recording; clicks, taps, form
  input, or scroll position outside the seven named events; cookies (persistence is
  `localStorage`-only).
- **What's approximate even in what IS collected:** `platform` is a coarse ~7-bucket
  device/browser classification (see `src/lib/telemetry/platform.ts`), not a UA string — by design,
  it carries negligible entropy per guest.

## Browser support

Baseline is iOS Safari 17+ and the current plus previous two Android Chrome releases. Desktop
browsers work for choosing an existing image but are not the primary experience.

Automated tests and emulation **cannot** validate the native camera picker, share sheet, saving to
Photos, or large-photo memory behavior. Those require physical-device testing on at least one
iPhone/Safari and one Android/Chrome device before a real event.

## Physical-device checklist

Required on one iPhone/Safari and one Android/Chrome device before this is event-ready — not
optional, and not something CI or Playwright can substitute for:

- [ ] Scan the final printed (or on-screen) QR and load the production URL.
- [ ] Take a new photo, both portrait and landscape.
- [ ] Choose an existing photo, both portrait and landscape, including a high-resolution
      (40+ MP) one — specifically on the oldest/lowest-RAM device in the supported range, to
      confirm decoding it doesn't crash or reload the tab (see note below).
- [ ] On iPhone: choose an ordinary HEIC photo from the library.
- [ ] Preview orientation is correct for every case above.
- [ ] Drag and zoom the photo; no empty edge ever appears.
- [ ] Exported image has the correct overlay alignment and resolution.
- [ ] If more than one overlay is configured, tapping each picker option updates both the live
      preview and the exported image; the editing screen still fits without scrolling.
- [ ] Native share sheet opens with the image attached; save to Photos/Gallery succeeds.
- [ ] Cancel the share sheet, then retry successfully.
- [ ] Tap "Save or share" twice in quick succession; confirm only one share sheet appears (this
      is enforced in code — `useGuestFlow`'s `attemptShare` ignores a second tap while a share is
      already in flight — but is worth a real-device sanity check).
- [ ] Exercise the fallback save path (e.g. by declining/failing the share sheet).
- [ ] Retake and re-select the same photo; the app accepts it again.
- [ ] Repeat the full flow three times in a row without a reload or crash.

Strongly recommended in addition: Samsung Internet, an older supported iPhone, low-power mode, and
loading over poor event Wi-Fi/cellular (then switching to airplane mode to confirm editing/export
still work once the page and overlay have loaded).

**Known tradeoff — large-photo decode memory:** `src/lib/image/decode.ts` decodes a selected photo
at its full native resolution via `createImageBitmap` before drawing it down into the bounded,
capped canvas that's actually kept (the oversized bitmap is closed immediately after). For a
48 MP photo that's a transient ~195 MB decode, released within roughly a frame. Browsers'
`createImageBitmap({ resizeWidth })` cannot safely avoid this: passing only `resizeWidth` upscales
images narrower than the cap and fails to cap the true long edge on portrait sources (verified
empirically — a 600×800 portrait with `resizeWidth: 3000` produces 3000×4000, worse than doing
nothing). A correct fix needs the source's dimensions before decoding, which needs a lightweight
image-header parser this app doesn't currently have. The first high-resolution device-checklist
item above exists specifically to confirm this transient spike doesn't crash a real, in-baseline
device before assuming this is fine.
