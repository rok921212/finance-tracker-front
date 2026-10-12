import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Button, Banner, Modal, Table, Th, Td, Field, inputClass } from "../ui/ui";
import ScreenshotDropzone, { validateScreenshot } from "../payments/ScreenshotDropzone";
import { PublicLinkCard } from "./PublicPageTab";
import WheelSvg, { rotationFor } from "../public/WheelSvg";
import {
  adminCreateWheelSegment,
  adminDeleteWheelSegment,
  adminMoveWheelSegment,
  adminUpdateWheelConfig,
  adminUpdateWheelSegment,
  adminWheel,
  AdminWheel,
  AdminWheelSegment,
  WheelConfig,
} from "../../lib/paymentsApi";
import { errorMessage } from "../../lib/http";
import { compressImage } from "../../lib/compressImage";

export const PUBLIC_WHEEL_PATH = "/wheel";

// Server stores a 300px square; 600px keeps it sharp after its crop
const shrinkImage = (file: File) => compressImage(file, { maxWidth: 600, maxHeight: 600 });

// New segments take the next color, so a fresh wheel alternates nicely
const PALETTE = ["#dc2626", "#111827", "#f59e0b", "#1d4ed8", "#16a34a", "#9333ea", "#db2777", "#0891b2"];

type Draft = { label: string; amount: string; color: string };

const SegmentFields: React.FC<{ draft: Draft; onChange: (d: Draft) => void }> = ({ draft, onChange }) => (
  <div className="grid gap-2 sm:grid-cols-[1fr_10rem_3.5rem]">
    <input className={inputClass} placeholder="Reward, e.g. Free Play" value={draft.label} maxLength={40} onChange={(e) => onChange({ ...draft, label: e.target.value })} aria-label="Label" />
    <input
      className={inputClass}
      placeholder="Amount, e.g. $50"
      maxLength={30}
      value={draft.amount}
      onChange={(e) => onChange({ ...draft, amount: e.target.value })}
      aria-label="Amount"
    />
    <input
      type="color"
      className="h-full min-h-[2.5rem] w-full cursor-pointer rounded-lg border border-gray-700 bg-black/40 p-1"
      value={draft.color}
      onChange={(e) => onChange({ ...draft, color: e.target.value })}
      aria-label="Color"
    />
  </div>
);

const SettingsCard: React.FC<{ config: WheelConfig; segments: AdminWheelSegment[]; onSaved: (c: WheelConfig) => void }> = ({ config, segments, onSaved }) => {
  const [draft, setDraft] = useState(config);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  useEffect(() => setDraft(config), [config]);

  const active = segments.filter((s) => s.active);
  const set = <K extends keyof WheelConfig>(k: K, v: WheelConfig[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  const save = async (patch: Partial<WheelConfig>) => {
    setBusy(true);
    setMessage(null);
    try {
      onSaved(await adminUpdateWheelConfig(patch));
      setMessage({ tone: "ok", text: "Saved" });
    } catch (err) {
      setMessage({ tone: "error", text: errorMessage(err, "Could not save the settings") });
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save(draft);
  };

  return (
    <Card
      title="Wheel Settings"
      actions={
        <Button variant={config.enabled ? "danger" : "success"} className="px-3 py-1" disabled={busy} onClick={() => save({ enabled: !config.enabled })}>
          {config.enabled ? "Turn off" : "Turn on"}
        </Button>
      }
    >
      <p className="text-sm mb-4">
        Status:{" "}
        <span className={config.enabled ? "text-green-300 font-semibold" : "text-gray-400 font-semibold"}>{config.enabled ? "Open, visitors can spin" : "Closed"}</span>
        {config.enabled && active.length < 2 && <span className="text-yellow-300"> · add at least 2 active segments or the page stays closed</span>}
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Lands on" hint="The wheel always stops on this reward. Random picks any active segment.">
          <select
            className={inputClass}
            value={draft.targetSegmentId ?? ""}
            onChange={(e) => set("targetSegmentId", e.target.value || null)}
            aria-label="Lands on"
          >
            <option value="">Random</option>
            {segments.filter((s) => s.active || s.id === draft.targetSegmentId).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.active ? "" : " (hidden)"}
                {s.amount ? ` (${s.amount})` : ""}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Spin time (seconds)" hint="2 to 30">
            <input className={inputClass} type="number" min={2} max={30} value={draft.spinDurationSec} onChange={(e) => set("spinDurationSec", Number(e.target.value))} />
          </Field>
          <Field label="Full turns" hint="2 to 15">
            <input className={inputClass} type="number" min={2} max={15} value={draft.extraRotations} onChange={(e) => set("extraRotations", Number(e.target.value))} />
          </Field>
          <Field label="Wait between spins (s)" hint="Per visitor. 0 = no limit">
            <input className={inputClass} type="number" min={0} value={draft.cooldownSec} onChange={(e) => set("cooldownSec", Number(e.target.value))} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title">
            <input className={inputClass} value={draft.title} maxLength={60} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label="Subtitle (optional)">
            <input className={inputClass} value={draft.subtitle} maxLength={160} onChange={(e) => set("subtitle", e.target.value)} />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" loading={busy} disabled={!dirty}>
            Save settings
          </Button>
          {dirty && (
            <Button type="button" variant="ghost" onClick={() => setDraft(config)} disabled={busy}>
              Reset
            </Button>
          )}
        </div>
      </form>
      {message && (
        <div className="mt-3">
          <Banner tone={message.tone}>{message.text}</Banner>
        </div>
      )}
    </Card>
  );
};

// Local-only spin: shows the admin the timing and landing without recording anything
const PreviewCard: React.FC<{ config: WheelConfig; segments: AdminWheelSegment[] }> = ({ config, segments }) => {
  const active = useMemo(() => segments.filter((s) => s.active).sort((a, b) => a.sortOrder - b.sortOrder), [segments]);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [landed, setLanded] = useState<string | null>(null);
  const target = useRef<AdminWheelSegment | null>(null);

  const testSpin = () => {
    if (spinning || active.length < 2) return;
    let index = active.findIndex((s) => s.id === config.targetSegmentId);
    if (index === -1) index = Math.floor(Math.random() * active.length);
    target.current = active[index];
    setLanded(null);
    setSpinning(true);
    setRotation((r) => rotationFor(r, index, active.length, config.extraRotations, Math.random() * 2 - 1));
  };

  return (
    <Card
      title="Preview"
      actions={
        <Button variant="ghost" className="px-3 py-1" onClick={testSpin} disabled={spinning || active.length < 2}>
          {spinning ? "Spinning…" : "Test spin"}
        </Button>
      }
    >
      <div className="mx-auto max-w-[360px] pt-3">
        <WheelSvg
          segments={active}
          rotation={rotation}
          duration={spinning ? config.spinDurationSec : 0}
          onSpinEnd={() => {
            if (!target.current) return;
            setLanded(target.current.label);
            target.current = null;
            setSpinning(false);
          }}
        />
      </div>
      <p className="text-center text-sm text-gray-400 mt-3 min-h-[1.25rem]">
        {active.length < 2 ? "Add at least 2 active segments." : landed ? `Landed on ${landed}. Test spins are not recorded.` : "Test spins use the saved settings."}
      </p>
    </Card>
  );
};

const AddSegmentForm: React.FC<{ nextColor: string; disabled: boolean; onCreated: (s: AdminWheelSegment) => void }> = ({ nextColor, disabled, onCreated }) => {
  const [draft, setDraft] = useState<Draft>({ label: "", amount: "", color: nextColor });
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const imageError = image ? validateScreenshot(image) : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.label.trim() || imageError) return;
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("label", draft.label.trim());
      form.append("amount", draft.amount.trim());
      form.append("color", draft.color);
      if (image) form.append("image", await shrinkImage(image));
      const s = await adminCreateWheelSegment(form);
      onCreated(s);
      setMessage({ tone: "ok", text: `Added ${s.label}` });
      setImage(null);
    } catch (err) {
      setMessage({ tone: "error", text: errorMessage(err, "Could not add the segment") });
    } finally {
      setBusy(false);
    }
  };

  // After a successful add, the form resets with the following palette color
  useEffect(() => setDraft({ label: "", amount: "", color: nextColor }), [nextColor]);

  return (
    <Card title="Add Segment">
      <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <SegmentFields draft={draft} onChange={setDraft} />
          <p className="text-xs text-gray-500">The amount is free text, e.g. $50, 500 coins or 10 Free Spins. Leave it empty to show only the label.</p>
          <Button type="submit" loading={busy} disabled={disabled || !draft.label.trim() || !!imageError}>
            Add Segment
          </Button>
        </div>
        <ScreenshotDropzone
          file={image}
          onChange={setImage}
          disabled={busy}
          error={imageError || undefined}
          prompt="Drop a reward picture here or click to browse (optional)"
          hint="Shown as a small circle inside the slice."
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

const WheelTab: React.FC = () => {
  const [data, setData] = useState<AdminWheel | null>(null);
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null);
  const [deleting, setDeleting] = useState<AdminWheelSegment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One hidden file input shared by every row; imageFor is the segment it is picking for
  const fileRef = useRef<HTMLInputElement>(null);
  const imageFor = useRef<string | null>(null);

  const load = useCallback(() => {
    adminWheel()
      .then(setData)
      .catch((e) => setError(errorMessage(e, "Could not load the wheel")));
  }, []);
  useEffect(load, [load]);

  const segments = useMemo(() => (data ? [...data.segments].sort((a, b) => a.sortOrder - b.sortOrder) : []), [data]);
  const config = data?.config;

  const upsert = (s: AdminWheelSegment) =>
    setData((prev) => {
      if (!prev) return prev;
      const i = prev.segments.findIndex((x) => x.id === s.id);
      return { ...prev, segments: i >= 0 ? prev.segments.map((x) => (x.id === s.id ? s : x)) : [...prev.segments, s] };
    });
  const setConfig = (c: WheelConfig) => setData((prev) => prev && { ...prev, config: c });

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
    const order = new Map((await adminMoveWheelSegment(id, direction)).changed);
    setData((prev) => prev && { ...prev, segments: prev.segments.map((s) => (order.has(s.id) ? { ...s, sortOrder: order.get(s.id) as number } : s)) });
  };

  const pickImage = (id: string) => {
    imageFor.current = id;
    fileRef.current?.click();
  };

  const onImagePicked = (file: File | undefined) => {
    const id = imageFor.current;
    if (fileRef.current) fileRef.current.value = ""; // picking the same file again still fires
    if (!file || !id) return;
    const invalid = validateScreenshot(file);
    if (invalid) return setError(invalid);
    run(async () => {
      const form = new FormData();
      form.append("image", await shrinkImage(file));
      upsert(await adminUpdateWheelSegment(id, form));
    });
  };

  const removeImage = (id: string) =>
    run(async () => {
      const form = new FormData();
      form.append("removeImage", "true");
      upsert(await adminUpdateWheelSegment(id, form));
    });

  const toggleActive = (s: AdminWheelSegment) =>
    run(async () => {
      upsert(await adminUpdateWheelSegment(s.id, { active: !s.active }));
    });

  const setTarget = (id: string | null) => run(async () => setConfig(await adminUpdateWheelConfig({ targetSegmentId: id })));

  const confirmDelete = () =>
    deleting &&
    run(async () => {
      await adminDeleteWheelSegment(deleting.id);
      // The server also clears the landing target when it pointed here
      setData(
        (prev) =>
          prev && {
            ...prev,
            segments: prev.segments.filter((s) => s.id !== deleting.id),
            config: prev.config.targetSegmentId === deleting.id ? { ...prev.config, targetSegmentId: null } : prev.config,
          }
      );
      setDeleting(null);
    });

  const max = data?.limits.maxSegments ?? 24;
  const target = config?.targetSegmentId ? segments.find((s) => s.id === config.targetSegmentId) : null;

  return (
    <div className="space-y-6">
      <PublicLinkCard
        path={PUBLIC_WHEEL_PATH}
        title="Wheel of Fortune Link"
        description="Share this link with anyone. It needs no login. Visitors press Spin and the wheel lands on the reward you choose below."
      />
      {error && <Banner>{error}</Banner>}
      {!data && !error && <Card title="Wheel"><Table loading head={<Th>Segment</Th>}>{null}</Table></Card>}

      {data && config && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <SettingsCard config={config} segments={segments} onSaved={setConfig} />
            <PreviewCard config={config} segments={segments} />
          </div>

          <AddSegmentForm nextColor={PALETTE[segments.length % PALETTE.length]} disabled={segments.length >= max} onCreated={upsert} />

          <input
            ref={fileRef}
            type="file"
            accept=".avif,image/avif,image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => onImagePicked(e.target.files?.[0])}
          />

          <Card
            title={`Segments (${segments.length}/${max})`}
            actions={<span className="text-sm text-gray-400">Lands on: <span className="text-white font-semibold">{target ? target.label : "Random"}</span></span>}
          >
            {segments.length === 0 ? (
              <p className="text-center text-gray-400 py-6">No segments yet. Add your first reward above.</p>
            ) : (
              <Table
                head={
                  <>
                    <Th>Order</Th>
                    <Th>Image</Th>
                    <Th>Reward</Th>
                    <Th>Status</Th>
                    <Th right>Actions</Th>
                  </>
                }
              >
                {segments.map((s, i) => {
                  const isTarget = config.targetSegmentId === s.id;
                  return (
                    <tr key={s.id} className={`align-top ${isTarget ? "bg-yellow-500/10" : "hover:bg-white/5"}`}>
                      <Td>
                        <div className="flex gap-1">
                          <button className="px-2 rounded bg-gray-700/60 disabled:opacity-30" disabled={busy || i === 0} onClick={() => run(() => move(s.id, "up"))} aria-label={`Move ${s.label} up`}>
                            ↑
                          </button>
                          <button
                            className="px-2 rounded bg-gray-700/60 disabled:opacity-30"
                            disabled={busy || i === segments.length - 1}
                            onClick={() => run(() => move(s.id, "down"))}
                            aria-label={`Move ${s.label} down`}
                          >
                            ↓
                          </button>
                        </div>
                      </Td>
                      <Td>
                        <button
                          type="button"
                          className="flex items-center justify-center w-14 h-14 rounded-full overflow-hidden border-4 hover:opacity-80 disabled:opacity-50"
                          style={{ borderColor: s.color, background: s.color }}
                          disabled={busy}
                          onClick={() => pickImage(s.id)}
                          title={s.imageUrl ? "Replace image" : "Upload image"}
                          aria-label={`${s.imageUrl ? "Replace" : "Upload"} image for ${s.label}`}
                        >
                          {s.imageUrl ? <img src={s.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" /> : <span className="text-white/80 text-xl leading-none">+</span>}
                        </button>
                      </Td>
                      <Td className="text-white">
                        {editing?.id === s.id ? (
                          <form
                            className="space-y-2 min-w-[18rem]"
                            onSubmit={(e) => {
                              e.preventDefault();
                              const d = editing.draft;
                              run(async () => {
                                upsert(await adminUpdateWheelSegment(s.id, { label: d.label.trim(), amount: d.amount.trim(), color: d.color }));
                                setEditing(null);
                              });
                            }}
                          >
                            <SegmentFields draft={editing.draft} onChange={(draft) => setEditing({ id: s.id, draft })} />
                            <div className="flex gap-2">
                              <Button type="submit" className="px-3 py-1" loading={busy} disabled={!editing.draft.label.trim()}>
                                Save
                              </Button>
                              <Button type="button" variant="ghost" className="px-3 py-1" onClick={() => setEditing(null)}>
                                Cancel
                              </Button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <div className="font-medium break-words">{s.label}</div>
                            <div className="text-sm text-yellow-300 break-words">{s.amount || "No amount"}</div>
                            {isTarget && <div className="text-xs text-yellow-300 font-semibold mt-1">★ The wheel lands here</div>}
                          </>
                        )}
                      </Td>
                      <Td>
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${s.active ? "border-green-500/40 text-green-300" : "border-gray-600 text-gray-400"}`}>
                          {s.active ? "Active" : "Hidden"}
                        </span>
                      </Td>
                      <Td right>
                        <div className="flex flex-wrap gap-2 justify-end">
                          {s.active && (
                            <Button
                              variant={isTarget ? "ghost" : "success"}
                              className="px-3 py-1 whitespace-nowrap"
                              disabled={busy}
                              onClick={() => setTarget(isTarget ? null : s.id)}
                            >
                              {isTarget ? "Make random" : "Land here"}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            className="px-3 py-1"
                            disabled={busy}
                            onClick={() => setEditing({ id: s.id, draft: { label: s.label, amount: s.amount, color: s.color } })}
                          >
                            Edit
                          </Button>
                          {s.imageUrl && (
                            <Button variant="ghost" className="px-3 py-1 whitespace-nowrap" disabled={busy} onClick={() => removeImage(s.id)}>
                              Remove image
                            </Button>
                          )}
                          <Button variant={s.active ? "danger" : "success"} className="px-3 py-1" disabled={busy} onClick={() => toggleActive(s)}>
                            {s.active ? "Hide" : "Show"}
                          </Button>
                          <Button variant="danger" className="px-3 py-1" disabled={busy} onClick={() => setDeleting(s)}>
                            Delete
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            )}
            {target && !target.active && (
              <div className="mt-3">
                <Banner tone="info">The chosen segment is hidden, so the wheel lands randomly until you show it or pick another.</Banner>
              </div>
            )}
          </Card>

          <Card title="Recent Spins" actions={<Button variant="ghost" className="px-3 py-1" onClick={load}>Refresh</Button>}>
            <Table
              empty={data.recentSpins.length === 0}
              head={
                <>
                  <Th>Time</Th>
                  <Th>Reward</Th>
                  <Th right>Amount</Th>
                  <Th>Result</Th>
                </>
              }
            >
              {data.recentSpins.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-gray-400">{new Date(r.createdAt).toLocaleString()}</Td>
                  <Td className="text-white">{r.label}</Td>
                  <Td right>{r.amount || "—"}</Td>
                  <Td>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${r.forced ? "border-yellow-500/40 text-yellow-300" : "border-gray-600 text-gray-400"}`}>
                      {r.forced ? "Chosen" : "Random"}
                    </span>
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}

      <Modal open={!!deleting} onClose={() => !busy && setDeleting(null)} title="Delete segment">
        {deleting && (
          <div className="space-y-4">
            <p className="text-gray-300 text-sm">
              Delete <span className="text-white font-semibold">{deleting.label}</span> from the wheel? To take it off for now, hide it instead.
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

export default WheelTab;
