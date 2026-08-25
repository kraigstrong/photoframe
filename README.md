# Event Photo Frame

A mobile-first web app that lets an event guest scan a QR code, pick or take a photo, position it
under a transparent event overlay, and share the finished image.

**The photo never leaves the device.** All decoding, cropping, compositing, and encoding happen in
the browser. There is no upload, no backend, no database, no account, and no analytics.

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
title, instruction and privacy copy, output dimensions, JPEG quality, filename prefix, camera
facing hint, and theme colors. Do not duplicate these values in components.

One deployment serves exactly one configured event.

## Replacing the overlay

`src/assets/overlay-placeholder.png` is a **clearly labeled development placeholder**. It is not
production artwork. To use the real event frame:

1. Export the overlay as a **PNG with a real alpha channel** at exactly **1080 × 1350** — it must
   match `outputWidth` × `outputHeight` in `src/config/event.ts`. If you change the output size,
   change both together.
2. Make every area that should reveal the guest's photo **fully transparent**. Semi-transparent
   pixels composite over the photo and are allowed, but flattened white or black backgrounds will
   hide the photo entirely.
3. Keep logos, text, and sponsor marks inside a safe area roughly 5% in from each edge so nothing
   is lost if the frame is printed or cropped downstream.
4. Save it into `src/assets/` and point `overlayAsset` in `src/config/event.ts` at the new file.
   Importing it through `src/assets/` (rather than `public/`) is required: Vite gives it a hashed
   filename, so a replaced overlay is never served from a stale cache.
5. Run `npm run build` and confirm the overlay is present in `dist/assets/` and that the total
   transfer stays within the ~2 MB budget.

The overlay is loaded and decoded before editing is enabled, always renders at full output bounds,
and never pans or zooms with the photo.

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
  service worker, analytics, or error monitoring.
- Neither is persisted to `localStorage`, IndexedDB, or Cache Storage.
- No third-party scripts, fonts, or asset CDNs.
- The app fetches only its own static assets from its own origin.

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
- [ ] Drag, pinch-to-zoom, and use the zoom slider; no empty edge ever appears. Lifting one finger
      mid-pinch should hand off to a smooth one-finger drag, not jump.
- [ ] Exported image has the correct overlay alignment and resolution.
- [ ] Tap "Save": the photo saves without any share sheet or destination picker ever appearing.
      This is a plain browser download (`shareService.saveFallback`); iOS Safari's handling of it
      is version-dependent and may open the image in a new tab instead of downloading it directly
      — if so, confirm the guest can still long-press → "Save to Photos" from there.
- [ ] Tap "Share": the native share sheet opens with the image attached; save to Photos/Gallery
      and share to another app both succeed from within it.
- [ ] Cancel the share sheet, then retry successfully.
- [ ] Tap "Share" twice in quick succession; confirm only one share sheet appears (this is
      enforced in code — `useGuestFlow`'s `attemptShare` ignores a second tap while a share is
      already in flight — but is worth a real-device sanity check).
- [ ] Exercise the fallback save path (e.g. by declining/failing the share sheet from "Share").
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
