/**
 * Typed event configuration contract.
 *
 * Every event-specific value in the application must come from here. Do not
 * duplicate event names, colors, copy, or output dimensions in components.
 */
export type EventTheme = {
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  accent: string;
  accentText: string;
};

export type EventOverlay = {
  /** Stable key, used as the React list key and in tests. */
  id: string;
  /** Accessible label shown in the editing-screen overlay picker. */
  label: string;
  /** Same-origin URL of the transparent overlay PNG. */
  asset: string;
  /** Same-origin URL of the picker-button thumbnail image. */
  thumbnail: string;
};

export type EventConfig = {
  /** Display name of the event, shown in the landing state. */
  eventName: string;
  /** Value used for `document.title`. */
  pageTitle: string;
  /** Privacy reassurance. Must state the photo is not uploaded or stored. */
  privacyMessage: string;
  /** Telemetry disclosure, shown directly beneath `privacyMessage`.
   *
   * The app sends a small set of anonymous product-usage events (see
   * `src/lib/telemetry/types.ts`), so saying nothing would leave the
   * landing screen quietly incomplete. Keep it to one short line a parent
   * can read at a glance, and keep the boundary explicit: we count
   * interactions, we never receive the photo. */
  telemetryMessage: string;
  /** The frame designs the guest can choose between on the editing screen.
   * Always at least one; the picker UI only appears when there's more than
   * one. */
  overlays: EventOverlay[];
  /** Same-origin URL of the decorative sample photo shown in the
   * landing-screen preview frame. */
  previewPhoto: string;
  /** Exported image width in pixels. */
  outputWidth: number;
  /** Exported image height in pixels. */
  outputHeight: number;
  /** JPEG quality between 0 and 1 used for the exported image. */
  jpegQuality: number;
  /** Prefix for the generated filename, e.g. `my-event` -> `my-event-1234.jpg`. */
  filenamePrefix: string;
  /** Hint passed to the camera file input. Not a guarantee on any platform. */
  cameraFacing: 'user' | 'environment';
  /** Solid color painted behind the photo on the export canvas. */
  exportBackground: string;
  theme: EventTheme;
};
