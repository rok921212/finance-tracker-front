import React, { useEffect, useMemo, useRef, useState } from "react";
import { getPublicTags, PAYMENT_METHODS, paymentMethodLabel, peekPublicTags, PublicTag } from "../../lib/paymentsApi";
import { useDropTick } from "../../lib/cache";
import { errorMessage } from "../../lib/http";
import { Banner, Spinner } from "../ui/ui";

// Clipboard API needs https; older browsers / http fall back to a hidden textarea
const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  }
};

const CopyRow: React.FC<{ value: string; compact: boolean; downloadUrl: string | null }> = ({ value, compact, downloadUrl }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(value)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <div className="flex items-stretch rounded-lg border border-gray-700 overflow-hidden shrink-0">
      <span className={`flex-1 min-w-0 px-2 font-mono text-white bg-black/40 truncate select-all ${compact ? "text-xs py-1.5" : "text-sm py-2"}`} title={value}>
        {value}
      </span>
      <button
        onClick={copy}
        className={`${compact ? "px-2 text-xs" : "px-3 text-sm"} font-semibold whitespace-nowrap transition-colors ${copied ? "bg-green-600 text-white" : "bg-red-600 text-white hover:bg-red-700"}`}
        aria-label={`Copy ${value}`}
      >
        {copied ? "Copied!" : "Copy"}
      </button>
      {downloadUrl && (
        <a
          href={downloadUrl}
          className={`${compact ? "px-1.5" : "px-2.5"} flex items-center border-l border-gray-700 text-gray-200 hover:bg-white/10`}
          aria-label="Download QR"
          title="Download QR"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </a>
      )}
    </div>
  );
};

// Large QR for scanning from another phone; closes on ×, a backdrop click or Esc
const QrViewer: React.FC<{ tag: PublicTag; onClose: () => void }> = ({ tag, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="anim-fade fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`QR code for ${tag.handle}`} className="relative w-full max-w-md anim-pop" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute -top-3 -right-3 z-10 w-9 h-9 rounded-full bg-gray-900 border border-gray-600 text-white text-xl leading-none hover:bg-red-600 hover:border-red-500"
        >
          ×
        </button>
        <div className="bg-white rounded-2xl p-4">
          <img src={tag.qrUrl as string} alt={`QR code for ${tag.handle}`} className="w-full h-auto max-h-[75vh] object-contain" />
        </div>
        <p className="text-center font-mono text-white mt-3 break-all">{tag.handle}</p>
      </div>
    </div>
  );
};

// Card size outside the QR in px (padding, border, text rows, gaps); keep in step with TagCard's classes
const GAP = 12;
const CHROME = { normal: { x: 26, y: 128 }, compact: { x: 18, y: 74 } };
const MAX_QR = 320;
const COMPACT_BELOW = 110;
const MIN_QR = 48;
const MIN_CARD_WIDTH = 200;

interface Fit {
  cols: number;
  rows: number;
  qr: number;
  compact: boolean;
  /** Too many tags to fit even when compact: the grid scrolls rather than shrink further */
  overflow: boolean;
}

// The column count that leaves the biggest QR when `count` cards share a w × h box
const bestFit = (w: number, h: number, count: number, chrome: { x: number; y: number }) => {
  let best = { cols: 1, rows: count, qr: -Infinity };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cellW = (w - GAP * (cols - 1)) / cols;
    const cellH = (h - GAP * (rows - 1)) / rows;
    const qr = Math.min(cellW - chrome.x, cellH - chrome.y, MAX_QR);
    if (qr > best.qr) best = { cols, rows, qr };
  }
  return best;
};

/** Sizes the cards so all `count` of them fill the element without scrolling. */
const useFitGrid = (ref: React.RefObject<HTMLDivElement | null>, count: number): Fit | null => {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const hasCards = count > 0;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, hasCards]);

  return useMemo(() => {
    if (!size || count === 0) return null;
    const normal = bestFit(size.w, size.h, count, CHROME.normal);
    if (normal.qr >= COMPACT_BELOW) return { ...normal, qr: Math.floor(normal.qr), compact: false, overflow: false };
    const compact = bestFit(size.w, size.h, count, CHROME.compact);
    if (compact.qr >= MIN_QR) return { ...compact, qr: Math.floor(compact.qr), compact: true, overflow: false };
    const cols = Math.max(1, Math.floor((size.w + GAP) / (MIN_CARD_WIDTH + GAP)));
    return { cols, rows: Math.ceil(count / cols), qr: MIN_QR, compact: true, overflow: true };
  }, [size, count]);
};

const TagCard: React.FC<{ tag: PublicTag; fit: Fit; onView: () => void }> = ({ tag, fit, onView }) => {
  const { qr, compact } = fit;
  const chrome = compact ? CHROME.compact : CHROME.normal;
  return (
    <div
      className={`bg-white/5 rounded-xl border border-gray-700/50 flex flex-col min-w-0 ${compact ? "p-2 gap-1" : "p-3 gap-2"}`}
      style={{ width: `min(100%, ${Math.max(qr + chrome.x, MIN_CARD_WIDTH)}px)` }}
    >
      {tag.qrUrl && (
        <button
          onClick={onView}
          className="block self-center bg-white rounded-lg p-1 shrink-0"
          style={{ width: qr, height: qr }}
          aria-label={`Enlarge QR code for ${tag.handle}`}
          title="Tap to enlarge"
        >
          <img src={tag.qrUrl} alt={`QR code for ${tag.handle}`} className="w-full h-full object-contain" />
        </button>
      )}
      <div className={`flex items-center gap-2 min-w-0 ${compact ? "text-xs leading-4" : "text-sm leading-5"}`}>
        <span className="shrink-0 rounded bg-red-600/20 text-red-400 font-semibold px-1.5">{paymentMethodLabel(tag.method)}</span>
        {tag.name && <h3 className="text-white font-semibold truncate">{tag.name}</h3>}
      </div>
      {!compact && <p className="text-xs leading-4 h-4 text-gray-400 truncate">{tag.note}</p>}
      <CopyRow value={tag.handle} compact={compact} downloadUrl={tag.qrDownloadUrl} />
    </div>
  );
};

const PublicTags: React.FC = () => {
  const [tags, setTags] = useState<PublicTag[] | null>(() => peekPublicTags() ?? null);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<PublicTag | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Shown from the cache at once; reloaded when a background check finds newer tags
  const changed = useDropTick("/public/tags");
  useEffect(() => {
    getPublicTags()
      .then(setTags)
      .catch((e) => setError(errorMessage(e, "Could not load the tags")));
  }, [changed]);

  // One grid in payment-method order; each card names its method, so no section headings take up room
  const sorted = useMemo(() => PAYMENT_METHODS.flatMap((m) => (tags || []).filter((t) => t.method === m.value)), [tags]);
  const fit = useFitGrid(gridRef, sorted.length);

  return (
    <div className="h-dvh overflow-hidden flex flex-col bg-gradient-to-br from-black via-gray-900 to-black">
      <header className="shrink-0 bg-gradient-to-r from-gray-900 to-black border-b border-gray-800 px-4 md:px-8 py-2 md:py-4">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-xl md:text-3xl font-bold text-white">
            Payment <span className="text-red-500">Tags</span>
          </h1>
          <p className="hidden [@media(min-height:600px)]:block text-gray-400 text-sm mt-1">Scan or download a QR code, or copy a tag.</p>
        </div>
      </header>

      <main className={`flex-1 min-h-0 w-full max-w-7xl mx-auto px-3 md:px-8 py-3 md:py-6 flex flex-col gap-3 ${fit?.overflow ? "overflow-y-auto" : ""}`}>
        {error && <Banner>{error}</Banner>}
        {!tags && !error && (
          <div className="flex justify-center py-20 text-gray-400">
            <Spinner className="h-8 w-8" />
          </div>
        )}
        {tags && sorted.length === 0 && <p className="text-center text-gray-400 py-20">No payment tags available right now.</p>}
        {sorted.length > 0 && (
          <div ref={gridRef} className="flex-1 min-h-0">
            {fit && (
              <div
                className={`grid ${fit.overflow ? "" : "h-full"}`}
                style={{
                  gap: GAP,
                  gridTemplateColumns: `repeat(${fit.cols}, minmax(0, 1fr))`,
                  gridTemplateRows: fit.overflow ? undefined : `repeat(${fit.rows}, minmax(0, 1fr))`,
                }}
              >
                {sorted.map((t) => (
                  <div key={t.id} className="flex items-center justify-center min-w-0 min-h-0">
                    <TagCard tag={t} fit={fit} onView={() => setViewing(t)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {viewing && <QrViewer tag={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
};

export default PublicTags;
