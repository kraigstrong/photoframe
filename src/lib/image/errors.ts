/**
 * Error types raised by the image engine. Exported so callers (a later
 * milestone's guest-flow error mapping) can distinguish failure kinds with
 * `instanceof` instead of parsing message strings.
 */

/** A file could not be decoded as an image, or was not an image at all. */
export class ImageDecodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ImageDecodeError';
  }
}

/** A geometry/compositing precondition was violated (e.g. a released image). */
export class ImageEngineError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ImageEngineError';
  }
}
