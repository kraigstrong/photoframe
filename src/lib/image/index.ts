/**
 * Public entry point for the image engine. Assembles the frozen
 * `ImageEngine` interface from the individual modules in this directory, and
 * re-exports the additional pure helpers/types/errors the future editing UI
 * needs but that aren't part of that frozen interface.
 */
import { buildExportFilename, exportImage } from './compose.ts';
import { decode } from './decode.ts';
import { clamp, coverFit } from './geometry.ts';
import type { ImageEngine } from './types.ts';

export const imageEngine: ImageEngine = {
  decode,
  coverFit,
  clamp,
  export: exportImage,
};

export default imageEngine;

export { applyZoom, coverScale, MAX_RELATIVE_ZOOM, MIN_RELATIVE_ZOOM } from './geometry.ts';
export type { ImageSize } from './geometry.ts';
export { computeWorkingSize } from './sizing.ts';
export type { Size } from './sizing.ts';
export { buildExportFilename };
export { ImageDecodeError, ImageEngineError } from './errors.ts';
export type { WorkingImageSource } from './source.ts';

export * from './types.ts';

// Read-only pass-through so callers (and tests) that already import the
// engine don't need a second import for the frame dimensions it composites
// against. Never modified here.
export { eventConfig, outputAspectRatio } from '../../config/index.ts';
