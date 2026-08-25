/**
 * Pure sizing math for the "working image" downscale cap. Kept separate from
 * decode.ts so it can be unit tested without any real image decoding.
 */

export type Size = { width: number; height: number };

/**
 * Returns the largest size no bigger than `maxEdge` on its longest edge that
 * preserves the source aspect ratio. Never upscales.
 */
export function computeWorkingSize(
  sourceWidth: number,
  sourceHeight: number,
  maxEdge: number,
): Size {
  const longestEdge = Math.max(sourceWidth, sourceHeight);

  if (longestEdge <= maxEdge) {
    return { width: Math.round(sourceWidth), height: Math.round(sourceHeight) };
  }

  const scale = maxEdge / longestEdge;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}
