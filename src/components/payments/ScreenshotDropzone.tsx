import React, { useEffect, useRef, useState, DragEvent } from "react";

export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
export const MAX_CASHOUT_PROOF_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ["image/avif", "image/jpeg", "image/png", "image/webp"];
const ACCEPTED_EXT = /\.(avif|jpe?g|png|webp)$/i;

/** Client-side check for fast feedback; the server re-validates the real bytes. */
export const validateScreenshot = (file: File, maxBytes = MAX_SCREENSHOT_BYTES): string | null => {
  // Some browsers report AVIF with an empty MIME type, so fall back to the extension
  const typeOk = ACCEPTED.includes(file.type) || (!file.type && ACCEPTED_EXT.test(file.name));
  if (!typeOk) return "Unsupported image type. Use AVIF, JPG, PNG or WebP.";
  if (file.size > maxBytes) return `Image is too large (max ${Math.round(maxBytes / 1024 / 1024)}MB).`;
  return null;
};

interface Props {
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
  error?: string;
  maxBytes?: number;
  prompt?: string;
  hint?: string;
  /** Tall full-page captures: preview the whole image in a scrollable box instead of shrinking it */
  tall?: boolean;
}

const ScreenshotDropzone: React.FC<Props> = ({
  file,
  onChange,
  disabled,
  error,
  maxBytes = MAX_SCREENSHOT_BYTES,
  prompt = "Drop screenshot here or click to browse",
  hint,
  tall,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Object URL preview, revoked when the file changes or the component unmounts
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    const err = validateScreenshot(f, maxBytes);
    setLocalError(err);
    onChange(err ? null : f);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (!disabled) pick(e.dataTransfer.files?.[0]);
  };

  const shownError = localError || error;

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".avif,image/avif,image/jpeg,image/png,image/webp"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = ""; // allow re-selecting the same file
        }}
      />
      {file && preview ? (
        <div className="rounded-lg border border-gray-600 bg-black/40 p-3">
          <div className={tall ? "max-h-[70vh] overflow-y-auto rounded" : ""}>
            <img
              src={preview}
              alt="Screenshot preview"
              className={tall ? "w-full h-auto rounded" : "max-h-72 w-auto mx-auto rounded object-contain"}
              onError={() => setLocalError("This browser can't preview this image, but it can still be uploaded.")}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 mt-3 text-sm">
            <span className="text-gray-300 truncate max-w-[60%]" title={file.name}>
              {file.name} · {(file.size / 1024).toFixed(0)} KB
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={() => inputRef.current?.click()}
                className="px-3 py-1 rounded bg-gray-700/60 border border-gray-600 text-gray-200 hover:bg-gray-700 disabled:opacity-50"
              >
                Replace
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setLocalError(null);
                  onChange(null);
                }}
                className="px-3 py-1 rounded bg-red-600/20 border border-red-500/60 text-red-300 hover:bg-red-600/40 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => !disabled && inputRef.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !disabled && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center text-center rounded-lg border-2 border-dashed px-4 py-10 cursor-pointer transition-colors ${
            dragging ? "border-red-500 bg-red-500/10" : "border-gray-600 bg-black/30 hover:border-red-500/60"
          } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <svg className="w-10 h-10 text-red-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-white font-medium">{prompt}</p>
          <p className="text-gray-400 text-xs mt-1">
            {hint || `AVIF preferred · JPG, PNG, WebP · max ${Math.round(maxBytes / 1024 / 1024)}MB`}
          </p>
        </div>
      )}
      {shownError && <p className="text-red-400 text-xs mt-1">{shownError}</p>}
    </div>
  );
};

export default ScreenshotDropzone;
