/**
 * Pure transform math for fitting, clamping, and zooming a working image
 * inside the fixed output frame. No canvas or DOM APIs here — everything is
 * plain numbers, so this is fully unit-testable.
 *
 * Coordinate system: `Transform.x`/`y` are the position, in output-frame
 * pixels, of the scaled image's top-left corner. `Transform.scale` is a
 * multiplier *relative to the cover-fit baseline* (see types.ts): 1 means
 * "exactly cover, no zoom", up to `MAX_RELATIVE_ZOOM` means "zoomed in that
 * many times past cover". This keeps `clamp` a simple, frame-size-agnostic
 * range check instead of needing to recompute an absolute pixel scale bound
 * every time the frame size changes.
 */
import type { Transform, WorkingImage } from './types.ts';

/** Minimum relative zoom: exactly cover-fit, no zoom applied. */
export const MIN_RELATIVE_ZOOM = 1;
/** Maximum relative zoom: roughly 3x past the cover-fit baseline. */
export const MAX_RELATIVE_ZOOM = 3;

/** The subset of WorkingImage that geometry math actually needs. */
export type ImageSize = Pick<WorkingImage, 'width' | 'height'>;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Raw image-pixel -> frame-pixel scale factor that makes `image` cover a
 * `frameWidth x frameHeight` frame with no empty edge (CSS `object-fit:
 * cover` semantics). This is the baseline that `Transform.scale` is
 * relative to.
 */
export function coverScale(image: ImageSize, frameWidth: number, frameHeight: number): number {
  return Math.max(frameWidth / image.width, frameHeight / image.height);
}

/** Initial cover-fit transform: centered, no zoom. */
export function coverFit(image: ImageSize, frameWidth: number, frameHeight: number): Transform {
  const scale = coverScale(image, frameWidth, frameHeight);
  const renderedWidth = image.width * scale;
  const renderedHeight = image.height * scale;

  return {
    scale: MIN_RELATIVE_ZOOM,
    x: (frameWidth - renderedWidth) / 2,
    y: (frameHeight - renderedHeight) / 2,
  };
}

/**
 * Nearest valid transform: scale is clamped to
 * `[MIN_RELATIVE_ZOOM, MAX_RELATIVE_ZOOM]`, then x/y are clamped so the
 * scaled image always fully covers the frame (never reveals an empty edge).
 */
export function clamp(
  transform: Transform,
  image: ImageSize,
  frameWidth: number,
  frameHeight: number,
): Transform {
  const baseScale = coverScale(image, frameWidth, frameHeight);
  const relativeScale = clampNumber(transform.scale, MIN_RELATIVE_ZOOM, MAX_RELATIVE_ZOOM);
  const absoluteScale = baseScale * relativeScale;
  const renderedWidth = image.width * absoluteScale;
  const renderedHeight = image.height * absoluteScale;

  // renderedWidth/Height are always >= frameWidth/Height (cover-fit
  // guarantee), so these ranges are always valid (min <= 0 <= ... well,
  // min <= max = 0).
  const minX = Math.min(frameWidth - renderedWidth, 0);
  const minY = Math.min(frameHeight - renderedHeight, 0);

  return {
    scale: relativeScale,
    x: clampNumber(transform.x, minX, 0),
    y: clampNumber(transform.y, minY, 0),
  };
}

/**
 * Changes scale while preserving the image point currently rendered at the
 * frame's visual center, then re-clamps so the result stays valid. Not part
 * of the frozen `ImageEngine` interface, but needed by the (future) pinch/
 * slider zoom UI, so it lives here alongside the rest of the transform math.
 */
export function applyZoom(
  transform: Transform,
  newScale: number,
  image: ImageSize,
  frameWidth: number,
  frameHeight: number,
): Transform {
  const baseScale = coverScale(image, frameWidth, frameHeight);
  const oldAbsoluteScale = baseScale * transform.scale;
  const centerX = frameWidth / 2;
  const centerY = frameHeight / 2;

  // The image-space point currently rendered at the frame's visual center.
  const focalX = (centerX - transform.x) / oldAbsoluteScale;
  const focalY = (centerY - transform.y) / oldAbsoluteScale;

  const clampedScale = clampNumber(newScale, MIN_RELATIVE_ZOOM, MAX_RELATIVE_ZOOM);
  const newAbsoluteScale = baseScale * clampedScale;

  const next: Transform = {
    scale: newScale,
    x: centerX - focalX * newAbsoluteScale,
    y: centerY - focalY * newAbsoluteScale,
  };

  return clamp(next, image, frameWidth, frameHeight);
}
