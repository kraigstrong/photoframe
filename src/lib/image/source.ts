/**
 * Internal convention for attaching the actual decoded pixel source to a
 * `WorkingImage`.
 *
 * `WorkingImage` (types.ts) is a frozen public shape: `src`/`width`/`height`/
 * `release()`. It intentionally has no field for the real drawable pixels,
 * because that's a private implementation detail this module owns. Rather
 * than a WeakMap keyed by object identity (which would only work for images
 * `decode()` itself created), we use a wider internal type — a `WorkingImage`
 * plus a `drawable` field — that `decode()` populates and `export()` reads.
 * Because it's just a plain (optional, mutable) field, tests in this
 * directory can also construct their own `WorkingImageSource` objects
 * directly (e.g. backed by a `canvas`-package image) without going through
 * `decode()`, which is what lets compositing be unit tested in jsdom.
 *
 * External callers that only see the `WorkingImage` type never observe this
 * field.
 */
import { ImageEngineError } from './errors.ts';
import type { WorkingImage } from './types.ts';

export type WorkingImageSource = WorkingImage & {
  /** The decoded/downscaled pixel source. `null` once released. */
  drawable: CanvasImageSource | null;
};

function hasDrawable(image: WorkingImage): image is WorkingImageSource {
  return 'drawable' in image;
}

/** Reads the backing pixel source for a `WorkingImage`. Throws if unavailable. */
export function getWorkingImageSource(image: WorkingImage): CanvasImageSource {
  if (hasDrawable(image) && image.drawable) {
    return image.drawable;
  }

  throw new ImageEngineError(
    'This WorkingImage has no backing pixel source (it may have been released).',
  );
}
