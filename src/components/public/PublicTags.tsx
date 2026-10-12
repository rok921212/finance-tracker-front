import React, { useEffect, useMemo, useState } from "react";
import { getPublicTags, PAYMENT_METHODS, PublicTag } from "../../lib/paymentsApi";
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

const CopyRow: React.FC<{ value: string }> = ({ value }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(value)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <div className="flex items-stretch rounded-lg border border-gray-700 overflow-hidden">
      <span className="flex-1 min-w-0 px-3 py-2 font-mono text-white bg-black/40 break-all select-all">{value}</span>
      <button
        onClick={copy}
        className={`px-4 text-sm font-semibold whitespace-nowrap transition-colors ${copied ? "bg-green-600 text-white" : "bg-red-600 text-white hover:bg-red-700"}`}
        aria-label={`Copy ${value}`}
      >
        {copied ? "Copied!" : "Copy"}
      </button>
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

const TagCard: React.FC<{ tag: PublicTag; onView: () => void }> = ({ tag, onView }) => (
  <div className="bg-white/5 rounded-xl border border-gray-700/50 p-4 flex flex-col gap-3">
    {tag.qrUrl && (
      <button onClick={onView} className="block bg-white rounded-lg p-2" aria-label={`Enlarge QR code for ${tag.handle}`} title="Tap to enlarge">
        <img src={tag.qrUrl} alt={`QR code for ${tag.handle}`} loading="lazy" className="w-full aspect-square object-contain" />
      </button>
    )}
    {(tag.name || tag.note) && (
      <div>
        {tag.name && <h3 className="text-white font-semibold">{tag.name}</h3>}
        {tag.note && <p className="text-sm text-gray-400">{tag.note}</p>}
      </div>
    )}
    <CopyRow value={tag.handle} />
    {tag.qrDownloadUrl && (
      <a
        href={tag.qrDownloadUrl}
        className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-semibold border border-gray-600 text-gray-200 hover:bg-white/5"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Download QR
      </a>
    )}
  </div>
);

const PublicTags: React.FC = () => {
  const [tags, setTags] = useState<PublicTag[] | null>(null);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<PublicTag | null>(null);

  useEffect(() => {
    getPublicTags()
      .then(setTags)
      .catch((e) => setError(errorMessage(e, "Could not load the tags")));
  }, []);

  const groups = useMemo(
    () => PAYMENT_METHODS.map((m) => ({ ...m, tags: (tags || []).filter((t) => t.method === m.value) })).filter((g) => g.tags.length > 0),
    [tags]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black">
      <header className="bg-gradient-to-r from-gray-900 to-black border-b border-gray-800 px-4 md:px-8 py-5">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl md:text-3xl font-bold text-white">
            Payment <span className="text-red-500">Tags</span>
          </h1>
          <p className="text-gray-400 text-sm mt-1">Scan or download a QR code, or copy a tag.</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-10">
        {error && <Banner>{error}</Banner>}
        {!tags && !error && (
          <div className="flex justify-center py-20 text-gray-400">
            <Spinner className="h-8 w-8" />
          </div>
        )}
        {tags && groups.length === 0 && <p className="text-center text-gray-400 py-20">No payment tags available right now.</p>}
        {groups.map((g) => (
          <section key={g.value}>
            <h2 className="text-xl font-bold text-white mb-4 border-l-4 border-red-500 pl-3">{g.label}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
              {g.tags.map((t) => (
                <TagCard key={t.id} tag={t} onView={() => setViewing(t)} />
              ))}
            </div>
          </section>
        ))}
      </main>

      {viewing && <QrViewer tag={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
};

export default PublicTags;
