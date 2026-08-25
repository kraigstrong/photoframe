/** Promisified `HTMLCanvasElement.toBlob`. */
export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas failed to produce image data.'));
        }
      },
      type,
      quality,
    );
  });
}
