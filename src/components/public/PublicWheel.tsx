import React, { useEffect, useRef, useState } from "react";
import { getPublicWheel, spinWheel, PublicWheel as Wheel, WheelSpinResult } from "../../lib/paymentsApi";
import { errorCode, errorMessage } from "../../lib/http";
import { invalidateCached } from "../../lib/cache";
import { Banner, Spinner } from "../ui/ui";
import WheelSvg, { rotationFor } from "./WheelSvg";

// Shown once the wheel stops; closes on the button, a backdrop click or Esc
const ResultViewer: React.FC<{ result: WheelSpinResult; onClose: () => void }> = ({ result, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="anim-fade fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Your reward"
        className="anim-pop w-full max-w-sm rounded-2xl border border-red-500/50 bg-gradient-to-b from-gray-900 to-black p-6 text-center shadow-[0_0_60px_rgba(220,38,38,0.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm uppercase tracking-widest text-red-400 font-semibold">You won</p>
        {result.imageUrl && <img src={result.imageUrl} alt="" className="mx-auto mt-4 w-28 h-28 rounded-full object-cover border-4 border-white/80" />}
        <h2 className="mt-4 text-3xl font-extrabold text-white break-words">{result.label}</h2>
        {result.amount && <p className="mt-1 text-4xl font-black text-yellow-300 break-words">{result.amount}</p>}
        <button onClick={onClose} className="mt-6 w-full rounded-lg bg-red-600 py-3 font-semibold text-white hover:bg-red-700">
          Awesome!
        </button>
      </div>
    </div>
  );
};

const PublicWheel: React.FC = () => {
  const [wheel, setWheel] = useState<Wheel | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [duration, setDuration] = useState(0);
  const [result, setResult] = useState<WheelSpinResult | null>(null);
  const pending = useRef<WheelSpinResult | null>(null);

  const load = () =>
    getPublicWheel()
      .then((w) => {
        setWheel(w);
        return w;
      })
      .catch((e) => {
        setError(errorMessage(e, "Could not load the wheel"));
        return null;
      });

  useEffect(() => {
    load();
  }, []);

  const spin = async () => {
    if (!wheel || spinning) return;
    setSpinning(true);
    setNotice("");
    try {
      const res = await spinWheel();
      let current = wheel;
      let index = current.segments.findIndex((s) => s.id === res.segmentId);
      // The admin changed the segments since the page loaded: redraw with the new ones first
      if (index === -1) {
        invalidateCached("/public/wheel");
        current = (await load()) || current;
        index = current.segments.findIndex((s) => s.id === res.segmentId);
      }
      if (index === -1) throw new Error("stale");
      pending.current = res;
      setDuration(res.spinDurationSec);
      setRotation((r) => rotationFor(r, index, current.segments.length, current.extraRotations, Math.random() * 2 - 1));
    } catch (e) {
      setSpinning(false);
      const code = errorCode(e);
      if (code === "WHEEL_CLOSED") {
        invalidateCached("/public/wheel");
        load();
      }
      setNotice(errorMessage(e, "Could not spin the wheel. Please try again."));
    }
  };

  const onSpinEnd = () => {
    if (!pending.current) return;
    setResult(pending.current);
    pending.current = null;
    setSpinning(false);
  };

  const open = wheel && wheel.enabled;

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black overflow-x-hidden">
      <header className="bg-gradient-to-r from-gray-900 to-black border-b border-gray-800 px-4 md:px-8 py-5">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-2xl md:text-4xl font-bold text-white">
            {wheel ? (
              wheel.title
            ) : (
              <>
                Wheel of <span className="text-red-500">Fortune</span>
              </>
            )}
          </h1>
          {wheel?.subtitle && <p className="text-gray-400 text-sm md:text-base mt-1">{wheel.subtitle}</p>}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 md:px-8 py-8 flex flex-col items-center gap-6">
        {error && <Banner>{error}</Banner>}
        {!wheel && !error && (
          <div className="flex justify-center py-20 text-gray-400">
            <Spinner className="h-8 w-8" />
          </div>
        )}
        {wheel && !open && (
          <div className="text-center py-16">
            <p className="text-2xl font-semibold text-white">The wheel is closed right now</p>
            <p className="text-gray-400 mt-2">Check back soon.</p>
          </div>
        )}
        {open && (
          <>
            <WheelSvg segments={wheel.segments} rotation={rotation} duration={duration} onSpinEnd={onSpinEnd} className="max-w-[min(90vw,520px)] mt-4" />
            <button
              onClick={spin}
              disabled={spinning}
              className="min-w-[12rem] rounded-full bg-red-600 px-10 py-4 text-xl font-extrabold uppercase tracking-wider text-white shadow-lg shadow-red-900/50 transition hover:bg-red-700 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {spinning ? "Spinning…" : "Spin"}
            </button>
            {notice && <Banner tone="info">{notice}</Banner>}
          </>
        )}
      </main>

      {result && <ResultViewer result={result} onClose={() => setResult(null)} />}
    </div>
  );
};

export default PublicWheel;
