// In-browser screenshot reading with Tesseract.js. The library (and its ~2-4MB engine + English
// data, fetched from a CDN and cached by the browser) is only loaded when the entry form opens, and
// one worker is kept for every scan, so each screenshot takes about a second.
import type { Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;

const getWorker = () => {
  if (!workerPromise) {
    workerPromise = import("tesseract.js")
      .then(({ createWorker }) => createWorker("eng"))
      .catch((e) => {
        workerPromise = null; // allow a retry (e.g. after a network blip)
        throw e;
      });
  }
  return workerPromise;
};

/** Start loading the OCR engine in the background so the first scan doesn't wait for it. */
export const preloadOcr = () => {
  const start = () => getWorker().catch(() => {});
  const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(start);
  else setTimeout(start, 500);
};

const MAX_WIDTH = 1000;

/**
 * Shrinks the image to at most ~1000px wide and makes it grayscale: much faster to recognise and
 * just as readable for payment-app text.
 */
const prepare = async (file: File): Promise<HTMLCanvasElement | File> => {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_WIDTH / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.filter = "grayscale(1) contrast(1.2)";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas;
  } catch {
    // e.g. a format this browser can't decode: let Tesseract try the file as-is
    return file;
  }
};

/** The text in a screenshot (empty if it can't be read). */
export const readScreenshotText = async (file: File): Promise<string> => {
  const [worker, image] = await Promise.all([getWorker(), prepare(file)]);
  const { data } = await worker.recognize(image);
  return data.text || "";
};
