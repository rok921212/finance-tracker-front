import React, { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "./ui";

interface Props {
  /** Full-size image; while it is null (loading) the placeholder is shown */
  src: string | null;
  /** Low-res image shown until `src` arrives */
  placeholder?: string | null;
  alt?: string;
  onClose: () => void;
}

const MIN = 1;
const MAX = 8;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Fullscreen image preview: scroll / pinch / buttons to zoom, drag to pan,
 * double-click to toggle zoom, Esc or backdrop click to close.
 */
const ImageViewer: React.FC<Props> = ({ src, placeholder, alt = "Screenshot", onClose }) => {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const moved = useRef(false);

  // Zoom to `next`, keeping the point (cx, cy) (client coords) fixed under the cursor
  const zoomAt = useCallback((next: number, cx?: number, cy?: number) => {
    setView((v) => {
      const scale = clamp(next, MIN, MAX);
      if (scale === MIN) return { scale: MIN, x: 0, y: 0 };
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect || cx === undefined || cy === undefined) return { ...v, scale };
      const px = cx - (rect.left + rect.width / 2);
      const py = cy - (rect.top + rect.height / 2);
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  }, []);

  const reset = () => setView({ scale: 1, x: 0, y: 0 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") zoomAt(view.scale * 1.25);
      else if (e.key === "-") zoomAt(view.scale / 1.25);
      else if (e.key === "0") reset();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, zoomAt, view.scale]);

  // Wheel must be non-passive to stop the page from scrolling
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        const factor = Math.exp(-e.deltaY * 0.0015);
        const scale = clamp(v.scale * factor, MIN, MAX);
        if (scale === MIN) return { scale: MIN, x: 0, y: 0 };
        const rect = el.getBoundingClientRect();
        const px = e.clientX - (rect.left + rect.width / 2);
        const py = e.clientY - (rect.top + rect.height / 2);
        const k = scale / v.scale;
        return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = Array.from(pointers.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      moved.current = true;
      zoomAt((pinch.current.scale * dist) / pinch.current.dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved.current = true;
    setView((v) => (v.scale === MIN ? v : { ...v, x: v.x + dx, y: v.y + dy }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const shown = src || placeholder;
  const btn =
    "w-10 h-10 flex items-center justify-center rounded-lg bg-gray-800/90 border border-gray-600 text-white text-lg hover:bg-gray-700 disabled:opacity-40";

  return (
    <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex flex-col" role="dialog" aria-modal="true" aria-label={alt}>
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-800">
        <span className="text-sm text-gray-300 tabular-nums">{Math.round(view.scale * 100)}%</span>
        <div className="flex items-center gap-2">
          <button className={btn} onClick={() => zoomAt(view.scale / 1.5)} disabled={view.scale <= MIN} aria-label="Zoom out">
            −
          </button>
          <button className={btn} onClick={() => zoomAt(view.scale * 1.5)} disabled={view.scale >= MAX} aria-label="Zoom in">
            +
          </button>
          <button className={`${btn} w-auto px-3 text-sm`} onClick={reset} disabled={view.scale === MIN}>
            Reset
          </button>
          {src && (
            <a href={src} target="_blank" rel="noopener noreferrer" className={`${btn} w-auto px-3 text-sm`}>
              Original
            </a>
          )}
          <button className={btn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className={`relative flex-1 overflow-hidden touch-none select-none flex items-center justify-center ${
          view.scale > MIN ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => {
          // Click on the empty backdrop (not a drag) closes when not zoomed
          if (e.target === e.currentTarget && !moved.current && view.scale === MIN) onClose();
        }}
        onDoubleClick={(e) => (view.scale > MIN ? reset() : zoomAt(2.5, e.clientX, e.clientY))}
      >
        {shown ? (
          <img
            src={shown}
            alt={alt}
            draggable={false}
            onLoad={() => src && setLoaded(true)}
            className="max-w-full max-h-full object-contain will-change-transform"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              transition: pointers.current.size ? "none" : "transform 80ms ease-out",
              filter: src ? undefined : "blur(2px)",
            }}
          />
        ) : null}
        {(!src || (!loaded && src !== placeholder)) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-gray-300">
            <Spinner className="h-8 w-8" />
          </div>
        )}
      </div>

      <p className="text-center text-xs text-gray-500 py-2 px-4">
        Scroll or pinch to zoom · drag to move · double-click to toggle zoom · Esc to close
      </p>
    </div>
  );
};

export default ImageViewer;
