import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Button, Banner, Modal, Table, Th, Td, inputClass } from "../ui/ui";
import ScreenshotDropzone, { validateScreenshot } from "../payments/ScreenshotDropzone";
import { PublicLinkCard } from "./PublicPageTab";
import {
  adminCreateTag,
  adminDeleteTag,
  adminMoveTag,
  adminTags,
  adminUpdateTag,
  AdminTag,
  PAYMENT_METHODS,
  PaymentMethod,
} from "../../lib/paymentsApi";
import { errorMessage } from "../../lib/http";
import { useDropTick } from "../../lib/cache";
import { compressImage } from "../../lib/compressImage";

export const PUBLIC_TAGS_PATH = "/tags";

// QR codes need to stay sharp, so they are only shrunk to the server's 1000px bound
const shrinkQr = (file: File) => compressImage(file, { maxWidth: 1000, maxHeight: 1000 });

const METHOD_LABEL = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.value, m.label])) as Record<PaymentMethod, string>;

type Draft = { method: PaymentMethod; handle: string; name: string; note: string };
const EMPTY: Draft = { method: "cashapp", handle: "", name: "", note: "" };

const TagFields: React.FC<{ draft: Draft; onChange: (d: Draft) => void }> = ({ draft, onChange }) => (
  <div className="grid gap-2 sm:grid-cols-2">
    <select className={inputClass} value={draft.method} onChange={(e) => onChange({ ...draft, method: e.target.value as PaymentMethod })} aria-label="Payment method">
      {PAYMENT_METHODS.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
        </option>
      ))}
    </select>
    <input className={inputClass} placeholder="Tag, e.g. $payme or email" value={draft.handle} maxLength={100} onChange={(e) => onChange({ ...draft, handle: e.target.value })} aria-label="Tag" />
    <input className={inputClass} placeholder="Name (optional)" value={draft.name} maxLength={60} onChange={(e) => onChange({ ...draft, name: e.target.value })} aria-label="Name" />
    <input className={inputClass} placeholder="Note for players (optional)" value={draft.note} maxLength={200} onChange={(e) => onChange({ ...draft, note: e.target.value })} aria-label="Note" />
  </div>
);

const AddTagForm: React.FC<{ onCreated: (t: AdminTag) => void }> = ({ onCreated }) => {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [qr, setQr] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const qrError = qr ? validateScreenshot(qr) : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.handle.trim() || qrError) return;
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      Object.entries(draft).forEach(([k, v]) => form.append(k, v.trim()));
      if (qr) form.append("qr", await shrinkQr(qr));
      const t = await adminCreateTag(form);
      onCreated(t);
      setMessage({ tone: "ok", text: `Added ${METHOD_LABEL[t.method]} tag ${t.handle}` });
      setDraft({ ...EMPTY, method: draft.method });
      setQr(null);
    } catch (err) {
      setMessage({ tone: "error", text: errorMessage(err, "Could not add the tag") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Add Tag">
      <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <TagFields draft={draft} onChange={setDraft} />
          <Button type="submit" loading={busy} disabled={!draft.handle.trim() || !!qrError}>
            Add Tag
          </Button>
        </div>
        <ScreenshotDropzone
          file={qr}
          onChange={setQr}
          disabled={busy}
          error={qrError || undefined}
          prompt="Drop the QR code here or click to browse (optional)"
          hint="Players can scan or download it. It is never cropped."
        />
      </form>
      {message && (
        <div className="mt-3">
          <Banner tone={message.tone}>{message.text}</Banner>
        </div>
      )}
    </Card>
  );
};

const TagsTab: React.FC = () => {
  const [tags, setTags] = useState<AdminTag[] | null>(null);
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null);
  const [deleting, setDeleting] = useState<AdminTag | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One hidden file input shared by every row; qrFor is the tag it is picking for
  const fileRef = useRef<HTMLInputElement>(null);
  const qrFor = useRef<string | null>(null);

  const load = useCallback(() => {
    adminTags()
      .then(setTags)
      .catch((e) => setError(errorMessage(e, "Could not load tags")));
  }, []);
  const changed = useDropTick("/admin/tags");
  useEffect(load, [load, changed]);

  const upsert = (t: AdminTag) =>
    setTags((prev) => {
      if (!prev) return prev;
      const i = prev.findIndex((x) => x.id === t.id);
      return i >= 0 ? prev.map((x) => (x.id === t.id ? t : x)) : [...prev, t];
    });

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e, "Action failed"));
    } finally {
      setBusy(false);
    }
  };

  const move = async (id: string, direction: "up" | "down") => {
    const order = new Map((await adminMoveTag(id, direction)).changed);
    setTags((prev) => prev && prev.map((t) => (order.has(t.id) ? { ...t, sortOrder: order.get(t.id) as number } : t)));
  };

  const pickQr = (id: string) => {
    qrFor.current = id;
    fileRef.current?.click();
  };

  const onQrPicked = (file: File | undefined) => {
    const id = qrFor.current;
    if (fileRef.current) fileRef.current.value = ""; // picking the same file again still fires
    if (!file || !id) return;
    const invalid = validateScreenshot(file);
    if (invalid) return setError(invalid);
    run(async () => {
      const form = new FormData();
      form.append("qr", await shrinkQr(file));
      upsert(await adminUpdateTag(id, form));
    });
  };

  const removeQr = (id: string) =>
    run(async () => {
      const form = new FormData();
      form.append("removeQr", "true");
      upsert(await adminUpdateTag(id, form));
    });

  const confirmDelete = () =>
    deleting &&
    run(async () => {
      await adminDeleteTag(deleting.id);
      setTags((prev) => prev && prev.filter((t) => t.id !== deleting.id));
      setDeleting(null);
    });

  // Grouped by payment method, in the same order as the public page
  const groups = useMemo(
    () =>
      PAYMENT_METHODS.map((m) => ({
        ...m,
        tags: (tags || []).filter((t) => t.method === m.value).sort((a, b) => a.sortOrder - b.sortOrder),
      })).filter((g) => g.tags.length > 0),
    [tags]
  );

  return (
    <div className="space-y-6">
      <PublicLinkCard
        path={PUBLIC_TAGS_PATH}
        title="Public Tags Link"
        description="Share this link with players. It needs no login and lists every active tag by payment method. Players can scan or download the QR code, or copy the tag."
      />
      <AddTagForm onCreated={upsert} />
      <input
        ref={fileRef}
        type="file"
        accept=".avif,image/avif,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => onQrPicked(e.target.files?.[0])}
      />
      {error && <Banner>{error}</Banner>}
      {tags && groups.length === 0 && (
        <Card>
          <p className="text-center text-gray-400 py-6">No tags yet. Add your first one above.</p>
        </Card>
      )}
      {!tags && !error && <Card title="Tags"><Table loading head={<Th>Tag</Th>}>{null}</Table></Card>}
      {groups.map((g) => (
        <Card key={g.value} title={`${g.label} (${g.tags.length})`}>
          <Table
            head={
              <>
                <Th>Order</Th>
                <Th>QR</Th>
                <Th>Tag</Th>
                <Th>Status</Th>
                <Th right>Actions</Th>
              </>
            }
          >
            {g.tags.map((t, i) => (
              <tr key={t.id} className="hover:bg-white/5 align-top">
                <Td>
                  <div className="flex gap-1">
                    <button className="px-2 rounded bg-gray-700/60 disabled:opacity-30" disabled={busy || i === 0} onClick={() => run(() => move(t.id, "up"))} aria-label={`Move ${t.handle} up`}>
                      ↑
                    </button>
                    <button
                      className="px-2 rounded bg-gray-700/60 disabled:opacity-30"
                      disabled={busy || i === g.tags.length - 1}
                      onClick={() => run(() => move(t.id, "down"))}
                      aria-label={`Move ${t.handle} down`}
                    >
                      ↓
                    </button>
                  </div>
                </Td>
                <Td>
                  <button
                    type="button"
                    className="flex items-center justify-center w-14 h-14 rounded-lg overflow-hidden border border-gray-700 bg-white hover:border-red-500/60 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => pickQr(t.id)}
                    title={t.qrUrl ? "Replace QR code" : "Upload QR code"}
                    aria-label={`${t.qrUrl ? "Replace" : "Upload"} QR code for ${t.handle}`}
                  >
                    {t.qrUrl ? <img src={t.qrUrl} alt="" className="w-full h-full object-contain" loading="lazy" /> : <span className="text-gray-500 text-xl leading-none">+</span>}
                  </button>
                </Td>
                <Td className="text-white">
                  {editing?.id === t.id ? (
                    <form
                      className="space-y-2 min-w-[18rem]"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const d = editing.draft;
                        run(async () => {
                          upsert(await adminUpdateTag(t.id, { method: d.method, handle: d.handle.trim(), name: d.name.trim(), note: d.note.trim() }));
                          setEditing(null);
                        });
                      }}
                    >
                      <TagFields draft={editing.draft} onChange={(draft) => setEditing({ id: t.id, draft })} />
                      <div className="flex gap-2">
                        <Button type="submit" className="px-3 py-1" loading={busy} disabled={!editing.draft.handle.trim()}>
                          Save
                        </Button>
                        <Button type="button" variant="ghost" className="px-3 py-1" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="font-mono font-medium break-all">{t.handle}</div>
                      {t.name && <div className="text-sm text-gray-400">{t.name}</div>}
                      {t.note && <div className="text-xs text-gray-500 mt-1">{t.note}</div>}
                    </>
                  )}
                </Td>
                <Td>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${t.active ? "border-green-500/40 text-green-300" : "border-gray-600 text-gray-400"}`}>
                    {t.active ? "Active" : "Disabled"}
                  </span>
                </Td>
                <Td right>
                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button
                      variant="ghost"
                      className="px-3 py-1"
                      disabled={busy}
                      onClick={() => setEditing({ id: t.id, draft: { method: t.method, handle: t.handle, name: t.name, note: t.note } })}
                    >
                      Edit
                    </Button>
                    {t.qrUrl && (
                      <Button variant="ghost" className="px-3 py-1 whitespace-nowrap" disabled={busy} onClick={() => removeQr(t.id)}>
                        Remove QR
                      </Button>
                    )}
                    <Button
                      variant={t.active ? "danger" : "success"}
                      className="px-3 py-1"
                      disabled={busy}
                      onClick={() => run(async () => upsert(await adminUpdateTag(t.id, { active: !t.active })))}
                    >
                      {t.active ? "Disable" : "Enable"}
                    </Button>
                    <Button variant="danger" className="px-3 py-1" disabled={busy} onClick={() => setDeleting(t)}>
                      Delete
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      ))}
      <Modal open={!!deleting} onClose={() => !busy && setDeleting(null)} title="Delete tag">
        {deleting && (
          <div className="space-y-4">
            <p className="text-gray-300 text-sm">
              Delete the {METHOD_LABEL[deleting.method]} tag <span className="font-mono text-white">{deleting.handle}</span>? It disappears from the public
              tags page. To hide it for now, disable it instead.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleting(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger" loading={busy} onClick={confirmDelete}>
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default TagsTab;
