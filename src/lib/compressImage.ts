/**
 * Shrinks an image in the browser before it is uploaded, so a 5-10MB phone screenshot goes over
 * the network as a few hundred KB. The server re-validates the bytes and still converts to AVIF.
 *
 * - Scaled down to fit maxWidth x maxHeight (never up), encoded as WebP (JPEG where the browser
 *   can't encode WebP, e.g. older Safari).
 * - The original is kept when it is AVIF (already optimized), already small and within bounds,
 *   when the browser can't decode it, or when re-encoding would not make it smaller.
 * - Same file in -> same result out (memoized), so a resubmit sends identical bytes.
 */

const SMALL_ENOUGH = 300 * 1024;
const QUALITY = 0.82;

const results = new WeakMap<File, Promise<File>>();

const encode = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY));

const shrink = async (file: File, maxWidth: number, maxHeight: number): Promise<File> => {
  if (file.type === "image/avif" || /\.avif$/i.test(file.name)) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // can't decode here: let the server handle it
  }
  const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
  if (scale === 1 && file.size <= SMALL_ENOUGH) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let blob = await encode(canvas, "image/webp");
  if (!blob || blob.type !== "image/webp") blob = await encode(canvas, "image/jpeg");
  if (!blob || blob.size >= file.size) return file;

  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + "." + ext, { type: blob.type });
};

export const compressImage = (file: File, opts: { maxWidth: number; maxHeight: number }): Promise<File> => {
  let p = results.get(file);
  if (!p) {
    p = shrink(file, opts.maxWidth, opts.maxHeight).catch(() => file);
    results.set(file, p);
  }
  return p;
};

/** Payment screenshot: same 1600px bound the server applies. */
export const compressScreenshot = (file: File) => compressImage(file, { maxWidth: 1600, maxHeight: 1600 });

/** Cashout proof: tall full-page captures keep their length; only the width is limited (16383 = WebP max). */
export const compressCashoutProof = (file: File) => compressImage(file, { maxWidth: 1600, maxHeight: 16383 });
