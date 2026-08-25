/**
 * Decodes a guest-selected `File` into a `WorkingImage`, entirely in the
 * browser. Never calls `fetch`/XHR, never logs the file, never touches
 * storage.
 */
import { canvasToBlob } from './canvas-utils.ts';
import { ImageDecodeError } from './errors.ts';
import { computeWorkingSize } from './sizing.ts';
import type { WorkingImageSource } from './source.ts';
import { MAX_WORKING_EDGE, type DecodeOptions, type WorkingImage } from './types.ts';

const IMAGE_EXTENSION_PATTERN = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i;

function isLikelyImageFile(file: File): boolean {
  if (file.type) {
    return file.type.startsWith('image/');
  }
  // Some platforms omit MIME type for certain formats (e.g. HEIC); fall
  // back to the extension rather than rejecting a real photo outright.
  return IMAGE_EXTENSION_PATTERN.test(file.name);
}

function toAbortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw toAbortError(signal);
  }
}

/** Rejects as soon as `signal` aborts, distinguishably from a decode failure. */
function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(toAbortError(signal));
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(toAbortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

type DecodedSource = {
  drawable: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
};

function supportsOrientedImageBitmap(): boolean {
  return typeof createImageBitmap === 'function';
}

async function decodeViaImageBitmap(file: File): Promise<DecodedSource> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return {
    drawable: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    dispose: () => bitmap.close(),
  };
}

/** Fallback for browsers without `createImageBitmap({ imageOrientation })`. */
async function decodeViaImageElement(file: File): Promise<DecodedSource> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.addEventListener('load', () => resolve(), { once: true });
      img.addEventListener(
        'error',
        () => reject(new ImageDecodeError('The selected file could not be decoded as an image.')),
        { once: true },
      );
      img.src = objectUrl;
    });
    return {
      drawable: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      dispose: () => {},
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function decodeSource(file: File): Promise<DecodedSource> {
  try {
    if (supportsOrientedImageBitmap()) {
      return await decodeViaImageBitmap(file);
    }
    return await decodeViaImageElement(file);
  } catch (err) {
    if (err instanceof ImageDecodeError) {
      throw err;
    }
    throw new ImageDecodeError('The selected file could not be decoded as an image.', {
      cause: err,
    });
  }
}

/** Decodes a user-selected file locally. Never transmits or logs the file. */
export async function decode(file: File, options: DecodeOptions = {}): Promise<WorkingImage> {
  const { signal } = options;
  const maxEdge = options.maxEdge ?? MAX_WORKING_EDGE;

  throwIfAborted(signal);

  if (!isLikelyImageFile(file)) {
    throw new ImageDecodeError(`Unsupported file type: "${file.type || file.name}".`);
  }

  const decodePromise = decodeSource(file);
  let decoded: DecodedSource;
  try {
    decoded = await raceWithAbort(decodePromise, signal);
  } catch (err) {
    // If we're bailing out early (most likely an abort), the underlying
    // decode may still be in flight. `decodePromise`'s eventual resolution
    // is otherwise silently discarded by the lost race, which would leak a
    // full-resolution ImageBitmap on every retake that outruns its decode.
    // `dispose()` is safe to call more than once, so this can never conflict
    // with the normal cleanup below.
    decodePromise.then((d) => d.dispose()).catch(() => {});
    throw err;
  }

  try {
    throwIfAborted(signal);

    const { width, height } = computeWorkingSize(decoded.width, decoded.height, maxEdge);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new ImageDecodeError('Unable to acquire a 2D canvas context to process the image.');
    }
    ctx.drawImage(decoded.drawable, 0, 0, width, height);

    throwIfAborted(signal);
    // Lossless preview blob: this is only ever displayed via CSS transform,
    // never exported, so there's no reason to introduce JPEG artifacts here.
    const previewBlob = await canvasToBlob(canvas, 'image/png');
    throwIfAborted(signal);

    let objectUrl: string | null = URL.createObjectURL(previewBlob);
    let released = false;

    const image: WorkingImageSource = {
      src: objectUrl,
      width,
      height,
      drawable: canvas,
      release() {
        if (released) {
          return;
        }
        released = true;
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
        image.drawable = null;
      },
    };

    return image;
  } finally {
    decoded.dispose();
  }
}
