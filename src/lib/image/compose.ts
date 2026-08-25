/**
 * Composites the working photo and the event overlay onto one bounded
 * canvas and encodes the result as a JPEG.
 */
import { eventConfig } from '../../config/index.ts';
import { canvasToBlob } from './canvas-utils.ts';
import { ImageEngineError } from './errors.ts';
import { coverScale } from './geometry.ts';
import { getWorkingImageSource } from './source.ts';
import type { ExportedImage, Transform, WorkingImage } from './types.ts';

const SAFE_FILENAME_PATTERN = /[^a-z0-9-]+/g;

function sanitizeForFilename(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(SAFE_FILENAME_PATTERN, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'photo';
}

function uniqueSuffix(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${random}`;
}

/** Builds a safe, unique export filename: `<prefix>-<unique>.jpg`. */
export function buildExportFilename(prefix: string): string {
  return `${sanitizeForFilename(prefix)}-${uniqueSuffix()}.jpg`;
}

/** Composites photo + overlay into one bounded canvas and encodes a JPEG. */
export async function exportImage(
  image: WorkingImage,
  transform: Transform,
  overlay: CanvasImageSource,
): Promise<ExportedImage> {
  const { outputWidth, outputHeight, jpegQuality, filenamePrefix, exportBackground } = eventConfig;

  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new ImageEngineError('Unable to acquire a 2D canvas context for export.');
  }

  // Painted behind the photo; only visible if rounding ever left a sliver
  // uncovered, since a clamp()-produced transform always fully covers the
  // frame.
  ctx.fillStyle = exportBackground;
  ctx.fillRect(0, 0, outputWidth, outputHeight);

  const source = getWorkingImageSource(image);
  const baseScale = coverScale(image, outputWidth, outputHeight);
  const absoluteScale = baseScale * transform.scale;
  const renderedWidth = image.width * absoluteScale;
  const renderedHeight = image.height * absoluteScale;
  ctx.drawImage(source, transform.x, transform.y, renderedWidth, renderedHeight);

  // Overlay is drawn undistorted at the full output bounds, never
  // panned/zoomed with the photo.
  ctx.drawImage(overlay, 0, 0, outputWidth, outputHeight);

  // Re-encoding through canvas is metadata-clean by construction: the
  // canvas holds only pixels, so no source EXIF/GPS survives into this
  // fresh JPEG encode.
  const blob = await canvasToBlob(canvas, 'image/jpeg', jpegQuality);
  const objectUrl = URL.createObjectURL(blob);
  const filename = buildExportFilename(filenamePrefix);

  let released = false;
  return {
    blob,
    objectUrl,
    filename,
    width: outputWidth,
    height: outputHeight,
    release() {
      if (released) {
        return;
      }
      released = true;
      URL.revokeObjectURL(objectUrl);
    },
  };
}
