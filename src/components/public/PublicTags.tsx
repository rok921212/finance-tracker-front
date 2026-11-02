import React, { useEffect, useMemo, useState } from "react";
import { getPublicTags, PAYMENT_METHODS, paymentMethodLabel, peekPublicTags, PublicTag } from "../../lib/paymentsApi";
import { Link, useSearchParams } from "react-router-dom";
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

// One tag per screen: the QR fills the space left by its label and copy row, so it scans easily
const TagSection: React.FC<{ tag: PublicTag; index: number; count: number }> = ({ tag, index, count }) => (
  <section
    className="h-full snap-start snap-always flex flex-col items-center gap-3 px-3 md:px-8 py-3 md:py-5"
    aria-label={`${paymentMethodLabel(tag.method)} ${tag.name || tag.handle}`}
  >
    <div className="w-full max-w-xl flex items-center gap-2 min-w-0 text-base md:text-lg shrink-0">
      <span className="shrink-0 rounded-md bg-red-600/20 text-red-400 font-semibold px-2 py-0.5">{paymentMethodLabel(tag.method)}</span>
      {tag.name && <h2 className="text-white font-semibold truncate">{tag.name}</h2>}
      {count > 1 && (
        <span className="ml-auto shrink-0 text-xs md:text-sm text-gray-500 tabular-nums">
          {index + 1} / {count}
        </span>
      )}
    </div>

    {tag.qrUrl ? (
      <div className="flex-1 min-h-0 w-full flex items-center justify-center">
        <div className="h-full max-h-full max-w-full aspect-square bg-white rounded-2xl p-3 md:p-4 shadow-2xl">
          <img src={tag.qrUrl} alt={`QR code for ${tag.handle}`} className="w-full h-full object-contain" />
        </div>
      </div>
    ) : (
      <div className="flex-1 min-h-0 w-full flex items-center justify-center text-gray-500">No QR code for this tag</div>
    )}

    <div className="w-full max-w-xl shrink-0 space-y-1.5">
      {tag.note && <p className="text-sm text-gray-400 text-center truncate">{tag.note}</p>}
      <CopyRow value={tag.handle} compact={false} downloadUrl={tag.qrDownloadUrl} />
    </div>
  </section>
);

const PublicTags: React.FC = () => {
  const [tags, setTags] = useState<PublicTag[] | null>(() => peekPublicTags() ?? null);
  const [error, setError] = useState("");
  // ?method=cashapp shows only that method's tags (the link next to each tag in the admin Tags tab)
  const [params] = useSearchParams();
  const methodParam = params.get("method");
  const method = PAYMENT_METHODS.some((m) => m.value === methodParam) ? methodParam : null;

  // Shown from the cache at once; reloaded when a background check finds newer tags
  const changed = useDropTick("/public/tags");
  useEffect(() => {
    getPublicTags()
      .then(setTags)
      .catch((e) => setError(errorMessage(e, "Could not load the tags")));
  }, [changed]);

  // Payment-method order; each section names its method
  const sorted = useMemo(
    () => PAYMENT_METHODS.filter((m) => !method || m.value === method).flatMap((m) => (tags || []).filter((t) => t.method === m.value)),
    [tags, method]
  );

  return (
    <div className="h-dvh overflow-hidden flex flex-col bg-gradient-to-br from-black via-gray-900 to-black">
      <header className="shrink-0 bg-gradient-to-r from-gray-900 to-black border-b border-gray-800 px-4 md:px-8 py-2 md:py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-baseline justify-between gap-x-4">
          <h1 className="text-xl md:text-2xl font-bold text-white">
            {method ? paymentMethodLabel(method) : "Payment"} <span className="text-red-500">Tags</span>
          </h1>
          <p className="text-gray-400 text-xs md:text-sm">
            {sorted.length > 1 ? "Scroll for the next tag. " : ""}Scan, download or copy.
            {method && (
              <>
                {" "}
                <Link to="/tags" className="text-gray-300 underline hover:text-white">
                  Show all methods
                </Link>
              </>
            )}
          </p>
        </div>
      </header>

      {/* Each tag fills the screen; scrolling snaps from one to the next */}
      <main className="flex-1 min-h-0 overflow-y-auto snap-y snap-mandatory overscroll-contain">
        {error && (
          <div className="max-w-xl mx-auto p-3">
            <Banner>{error}</Banner>
          </div>
        )}
        {!tags && !error && (
          <div className="flex justify-center py-20 text-gray-400">
            <Spinner className="h-8 w-8" />
          </div>
        )}
        {tags && sorted.length === 0 && (
          <p className="text-center text-gray-400 py-20">
            No {method ? `${paymentMethodLabel(method)} ` : "payment "}tags available right now.
          </p>
        )}
        {sorted.map((t, i) => (
          <TagSection key={t.id} tag={t} index={i} count={sorted.length} />
        ))}
      </main>
    </div>
  );
};

export default PublicTags;
