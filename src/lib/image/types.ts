/**
 * Interfaces owned by the orchestrator and implemented by the image engine.
 *
 * Ownership: `src/lib/image/**`. Implementations must contain no React and no
 * DOM presentation concerns beyond the canvas/bitmap APIs they require.
 */

/** A decoded, orientation-corrected, memory-bounded source image. */
export type WorkingImage = {
  /** Object URL or bitmap source suitable for CSS-transformed preview. */
  readonly src: string;
  /** Pixel width of the working (already downscaled) image. */
  readonly width: number;
  /** Pixel height of the working (already downscaled) image. */
  readonly height: number;
  /** Releases object URLs, bitmaps, and canvases. Safe to call twice. */
  release(): void;
};

/** Pan and zoom applied to the working image inside the fixed output frame. */
export type Transform = {
  /** Horizontal offset in output-frame pixels. */
  x: number;
  /** Vertical offset in output-frame pixels. */
  y: number;
  /** Scale multiplier relative to the cover-fit baseline. Always >= 1. */
  scale: number;
};

/** The finished, composited image held only in memory. */
export type ExportedImage = {
  readonly blob: Blob;
  readonly objectUrl: string;
  readonly filename: string;
  readonly width: number;
  readonly height: number;
  release(): void;
};

/** Maximum longest edge of the working image. See spec section 5.4. */
export const MAX_WORKING_EDGE = 3000;

export type DecodeOptions = {
  maxEdge?: number;
  signal?: AbortSignal;
};

export interface ImageEngine {
  /** Decodes a user-selected file locally. Never transmits or logs the file. */
  decode(file: File, options?: DecodeOptions): Promise<WorkingImage>;
  /** Initial cover-fit transform for an image in the configured output frame. */
  coverFit(image: WorkingImage, frameWidth: number, frameHeight: number): Transform;
  /** Clamps a transform so no empty edge is ever revealed. */
  clamp(
    transform: Transform,
    image: WorkingImage,
    frameWidth: number,
    frameHeight: number,
  ): Transform;
  /** Composites photo + overlay into one bounded canvas and encodes a JPEG. */
  export(
    image: WorkingImage,
    transform: Transform,
    overlay: CanvasImageSource,
  ): Promise<ExportedImage>;
}
