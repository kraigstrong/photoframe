/**
 * Frozen prop contracts for the guest-facing screen components.
 *
 * Ownership: `src/components/**`. Components are pure presentation — they
 * receive already-decoded/composited data and plain callbacks, and must not
 * import `src/state/useGuestFlow.ts` or reach into `src/lib/image` for
 * anything beyond the already-exported pure helpers (`clamp`, `applyZoom`,
 * `coverFit`, `MIN_RELATIVE_ZOOM`, `MAX_RELATIVE_ZOOM`) needed to turn drag/
 * slider input into a new `Transform` before calling `onTransformChange`.
 * Do not call `imageEngine.decode`/`imageEngine.export` directly from a
 * component — that orchestration lives in the hook.
 */
import type { AppError } from '../state/appState.ts';
import type { ShareConfirmation } from '../state/useGuestFlow.ts';
import type { ExportedImage, Transform, WorkingImage } from '../lib/image/types.ts';

export type LandingScreenProps = {
  eventName: string;
  privacyMessage: string;
  /** Telemetry disclosure, rendered directly beneath `privacyMessage`. */
  telemetryMessage: string;
  /** Same-origin sample-photo URL, shown decoratively in a preview frame. */
  previewPhoto: string;
  /** Passed straight through to the camera file input's `capture` attribute. */
  cameraFacing: 'user' | 'environment';
  /** Both file inputs stay disabled until the overlay has decoded. */
  overlayReady: boolean;
  onSelectFile: (file: File) => void;
  /** Fires when the guest presses a photo-source button, before the native
   *  picker opens. Reports intent; a photo may never actually arrive. */
  onSourceClick: (source: 'camera' | 'library') => void;
};

export type DecodingScreenProps = {
  message?: string;
};

export type EditingScreenProps = {
  eventName: string;
  image: WorkingImage;
  /** The frame designs the guest can pick between. Rendered above the photo,
   * decorative; the picker UI (tap to choose) only appears when there's more
   * than one. */
  overlays: { id: string; label: string; src: string; thumbnail: string }[];
  selectedOverlayIndex: number;
  onSelectOverlay: (index: number) => void;
  outputWidth: number;
  outputHeight: number;
  transform: Transform;
  /** The component computes the next valid Transform (via `clamp`/`applyZoom`
   * from `src/lib/image`) from drag/slider/keyboard input and reports it
   * here; it never mutates `transform` in place. */
  onTransformChange: (next: Transform) => void;
  onResetPosition: () => void;
  onChangePhoto: () => void;
  /** False while a fresh export is pending after the latest transform
   * change (debounced) — the Save/Share action must stay disabled and show
   * a "Preparing photo…" state until this flips true. */
  exportReady: boolean;
  onSaveOrShare: () => void;
  confirmation: ShareConfirmation;
};

export type FallbackScreenProps = {
  exported: ExportedImage;
  onDownload: () => void;
  onBackToEditing: () => void;
  onTryShareAgain: () => void;
  confirmation: ShareConfirmation;
};

export type ErrorScreenProps = {
  error: AppError;
  onRetry: () => void;
};
