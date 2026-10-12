import React, { useEffect, useState } from "react";
import { Card, Button, Banner, Spinner, inputClass } from "../ui/ui";
import ScreenshotDropzone, { validateScreenshot } from "../payments/ScreenshotDropzone";
import { adminBanner, adminDeleteBanner, adminUpdateBanner, adminUploadBanner, AdminBanner } from "../../lib/paymentsApi";
import { errorMessage } from "../../lib/http";
import { compressImage } from "../../lib/compressImage";

export const PUBLIC_GAMES_PATH = "/play";

/** A no-login page's full URL with Copy and Open buttons. */
export const PublicLinkCard: React.FC<{ path: string; title: string; description: React.ReactNode }> = ({ path, title, description }) => {
  const link = `${window.location.origin}${path}`;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (e.g. not https): the field is selectable, so it can be copied by hand
    }
  };

  return (
    <Card title={title}>
      <p className="text-sm text-gray-400 mb-3">{description}</p>
      <div className="flex flex-wrap gap-2">
        <input className={`${inputClass} flex-1 min-w-[16rem]`} value={link} readOnly onFocus={(e) => e.target.select()} aria-label={title} />
        <Button onClick={copy}>{copied ? "Copied!" : "Copy link"}</Button>
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center px-4 py-2 rounded-lg font-semibold border border-gray-600 text-gray-200 hover:bg-white/5"
        >
          Open
        </a>
      </div>
    </Card>
  );
};

const BannerCard: React.FC = () => {
  const [banner, setBanner] = useState<AdminBanner | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);

  const show = (b: AdminBanner) => {
    setBanner(b);
    setLink(b.link);
  };

  useEffect(() => {
    adminBanner()
      .then(show)
      .catch((e) => setMessage({ tone: "error", text: errorMessage(e, "Could not load the banner") }));
  }, []);

  const run = async (fn: () => Promise<AdminBanner>, ok: string) => {
    setBusy(true);
    setMessage(null);
    try {
      show(await fn());
      setMessage({ tone: "ok", text: ok });
    } catch (e) {
      setMessage({ tone: "error", text: errorMessage(e, "Could not save the banner") });
    } finally {
      setBusy(false);
    }
  };

  const fileError = file ? validateScreenshot(file) : null;

  const upload = () =>
    file &&
    !fileError &&
    run(async () => {
      const b = await adminUploadBanner(await compressImage(file, { maxWidth: 1600, maxHeight: 1600 }));
      setFile(null);
      return b;
    }, "Banner uploaded");

  return (
    <Card title="Popup Banner">
      <p className="text-sm text-gray-400 mb-4">
        Pops up as soon as someone opens the public games link. Visitors can close it. Any size works; wide images are
        shown up to 1200px wide.
      </p>
      {!banner && !message && (
        <div className="flex justify-center py-6 text-gray-400">
          <Spinner className="h-6 w-6" />
        </div>
      )}
      {banner && (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-300">Current banner</h4>
            {banner.imageUrl ? (
              <img src={banner.imageUrl} alt="Current popup banner" className="w-full max-h-80 object-contain rounded-lg border border-gray-700 bg-black/40" />
            ) : (
              <div className="rounded-lg border border-dashed border-gray-700 p-8 text-center text-sm text-gray-500">No banner yet</div>
            )}
            {banner.imageUrl && (
              <>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-red-600"
                    checked={banner.enabled}
                    disabled={busy}
                    onChange={(e) => run(() => adminUpdateBanner({ enabled: e.target.checked }), e.target.checked ? "Banner turned on" : "Banner turned off")}
                  />
                  Show the popup on the public page
                </label>
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(() => adminUpdateBanner({ link: link.trim() }), "Link saved");
                  }}
                >
                  <input
                    className={`${inputClass} flex-1 min-w-[12rem]`}
                    placeholder="Optional link when clicked (https://...)"
                    value={link}
                    maxLength={500}
                    onChange={(e) => setLink(e.target.value)}
                    aria-label="Banner link"
                  />
                  <Button type="submit" variant="ghost" loading={busy} disabled={link.trim() === banner.link}>
                    Save link
                  </Button>
                </form>
                <Button variant="danger" className="px-3 py-1" disabled={busy} onClick={() => run(adminDeleteBanner, "Banner removed")}>
                  Remove banner
                </Button>
              </>
            )}
          </div>
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-300">{banner.imageUrl ? "Replace banner" : "Upload banner"}</h4>
            <ScreenshotDropzone
              file={file}
              onChange={setFile}
              disabled={busy}
              error={fileError || undefined}
              prompt="Drop banner image here or click to browse"
              hint="AVIF, JPG, PNG or WebP, max 5MB"
            />
            <Button onClick={upload} loading={busy} disabled={!file || !!fileError}>
              Upload banner
            </Button>
          </div>
        </div>
      )}
      {message && (
        <div className="mt-4">
          <Banner tone={message.tone}>{message.text}</Banner>
        </div>
      )}
    </Card>
  );
};

const PublicPageTab: React.FC = () => (
  <div className="space-y-6">
    <PublicLinkCard
      path={PUBLIC_GAMES_PATH}
      title="Public Games Link"
      description="Share this link with anyone. It needs no login and shows every active game with its image, in the same order as the Games tab."
    />
    <PublicLinkCard
      path="/wheel"
      title="Wheel of Fortune Link"
      description="Share this link with anyone. Visitors press Spin and the wheel lands on the reward you set in the Wheel tab."
    />
    <BannerCard />
  </div>
);

export default PublicPageTab;
