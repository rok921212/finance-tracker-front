import React, { FormEvent, useEffect, useRef, useState } from "react";
import { Button, Banner, Spinner, inputClass } from "../ui/ui";
import {
  adminCreateGameCredential,
  adminDeleteGameCredential,
  adminGameCredentials,
  adminRevealGameCredential,
  adminUpdateGameCredential,
  GameCredential,
} from "../../lib/paymentsApi";
import { errorMessage } from "../../lib/http";

// A revealed password is hidden again after this long
const REVEAL_MS = 30_000;

const copy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

interface FormState {
  label: string;
  username: string;
  password: string;
  notes: string;
  adminUrl: string;
  gameUrl: string;
}
const EMPTY: FormState = { label: "", username: "", password: "", notes: "", adminUrl: "", gameUrl: "" };

// Opens a saved link in a new tab (no referrer / opener sent to the game site)
const LinkButton: React.FC<{ href: string; children: React.ReactNode; tone: string }> = ({ href, children, tone }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    referrerPolicy="no-referrer"
    title={href}
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border ${tone} hover:brightness-125`}
  >
    {children}
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5h5m0 0v5m0-5L10 14M5 9v10h10" />
    </svg>
  </a>
);

/** Backend logins (ID + password) saved for one game. Admin only; each reveal is audit-logged. */
const GameLoginsPanel: React.FC<{ gameId: string; gameName: string; onCount: (n: number) => void }> = ({ gameId, gameName, onCount }) => {
  const [items, setItems] = useState<GameCredential[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [showFormPassword, setShowFormPassword] = useState(false);
  // Editing an existing login (its id), or adding a new one (null)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const onCountRef = useRef(onCount);
  onCountRef.current = onCount;

  useEffect(() => {
    adminGameCredentials(gameId)
      .then((list) => {
        setItems(list);
        onCountRef.current(list.length);
      })
      .catch((e) => setError(errorMessage(e, "Could not load logins")));
  }, [gameId]);

  // Forget revealed passwords when the panel closes
  useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach(clearTimeout);
  }, []);

  const setList = (next: GameCredential[]) => {
    setItems(next);
    onCountRef.current(next.length);
  };

  const run = async (fn: () => Promise<void>) => {
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

  const flashCopied = (key: string) => {
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };

  const hide = (id: string) =>
    setRevealed((r) => {
      const { [id]: _, ...rest } = r;
      return rest;
    });

  const reveal = (id: string) =>
    run(async () => {
      const pw = await adminRevealGameCredential(gameId, id);
      setRevealed((r) => ({ ...r, [id]: pw }));
      clearTimeout(timers.current[id]);
      timers.current[id] = setTimeout(() => hide(id), REVEAL_MS);
    });

  const copyPassword = (id: string) =>
    run(async () => {
      const pw = revealed[id] ?? (await adminRevealGameCredential(gameId, id));
      if (await copy(pw)) flashCopied(`pw:${id}`);
      else setError("Could not copy. Reveal the password and copy it by hand.");
    });

  const startEdit = (c: GameCredential) => {
    setEditingId(c.id);
    setForm({ label: c.label, username: c.username, password: "", notes: c.notes, adminUrl: c.adminUrl, gameUrl: c.gameUrl });
    setShowFormPassword(false);
  };
  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY);
    setShowFormPassword(false);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.username.trim() || (!editingId && !form.password)) return;
    run(async () => {
      const body = {
        label: form.label.trim(),
        username: form.username.trim(),
        notes: form.notes.trim(),
        password: form.password,
        adminUrl: form.adminUrl.trim(),
        gameUrl: form.gameUrl.trim(),
      };
      if (editingId) {
        const updated = await adminUpdateGameCredential(gameId, editingId, body);
        setList((items || []).map((c) => (c.id === updated.id ? updated : c)));
        if (form.password) hide(editingId);
      } else {
        const created = await adminCreateGameCredential(gameId, body);
        setList([...(items || []), created]);
      }
      resetForm();
    });
  };

  return (
    <div className="rounded-lg border border-gray-700 bg-black/40 p-3 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-white">Backend logins · {gameName}</span>
        <span className="text-xs text-gray-500">Visible to admins only. Passwords are stored encrypted and every reveal is logged.</span>
      </div>
      {error && <Banner>{error}</Banner>}

      {!items ? (
        !error && (
          <div className="flex justify-center py-3 text-gray-400">
            <Spinner />
          </div>
        )
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-500">No logins saved for this game yet.</p>
      ) : (
        <ul className="divide-y divide-gray-800">
          {items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2 text-sm">
              <div className="min-w-[8rem]">
                <div className="text-gray-400 text-xs">{c.label || "Login"}</div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-white break-all">{c.username}</span>
                  <button
                    type="button"
                    className="text-xs text-gray-400 hover:text-white"
                    onClick={async () => (await copy(c.username)) && flashCopied(`id:${c.id}`)}
                    aria-label={`Copy ID ${c.username}`}
                  >
                    {copied === `id:${c.id}` ? "Copied ✓" : "Copy"}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-gray-200 break-all" aria-label="Password">
                  {revealed[c.id] ?? "••••••••"}
                </span>
                {revealed[c.id] !== undefined ? (
                  <button type="button" className="text-xs text-gray-400 hover:text-white" onClick={() => hide(c.id)}>
                    Hide
                  </button>
                ) : (
                  <button type="button" className="text-xs text-sky-300 hover:text-sky-200" disabled={busy} onClick={() => reveal(c.id)}>
                    Reveal
                  </button>
                )}
                <button type="button" className="text-xs text-gray-400 hover:text-white" disabled={busy} onClick={() => copyPassword(c.id)}>
                  {copied === `pw:${c.id}` ? "Copied ✓" : "Copy password"}
                </button>
              </div>
              {(c.adminUrl || c.gameUrl) && (
                <div className="flex flex-wrap gap-2">
                  {c.adminUrl && (
                    <LinkButton href={c.adminUrl} tone="border-red-500/50 bg-red-600/15 text-red-200">
                      Admin panel
                    </LinkButton>
                  )}
                  {c.gameUrl && (
                    <LinkButton href={c.gameUrl} tone="border-sky-500/50 bg-sky-600/15 text-sky-200">
                      Game link
                    </LinkButton>
                  )}
                </div>
              )}
              {c.notes && <div className="text-xs text-gray-500 basis-full">{c.notes}</div>}
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" className="px-3 py-1" disabled={busy} onClick={() => startEdit(c)}>
                  Edit
                </Button>
                {confirmDelete === c.id ? (
                  <>
                    <Button
                      variant="danger"
                      className="px-3 py-1"
                      loading={busy}
                      onClick={() =>
                        run(async () => {
                          await adminDeleteGameCredential(gameId, c.id);
                          setList(items.filter((x) => x.id !== c.id));
                          setConfirmDelete(null);
                          if (editingId === c.id) resetForm();
                        })
                      }
                    >
                      Confirm delete
                    </Button>
                    <Button variant="ghost" className="px-3 py-1" onClick={() => setConfirmDelete(null)}>
                      Keep
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" className="px-3 py-1" disabled={busy} onClick={() => setConfirmDelete(c.id)}>
                    Delete
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end" autoComplete="off">
        <input
          className={inputClass}
          placeholder="Label (optional)"
          aria-label="Label"
          value={form.label}
          maxLength={60}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
        />
        <input
          className={inputClass}
          placeholder="Backend ID / username"
          aria-label="Backend ID or username"
          value={form.username}
          maxLength={100}
          autoComplete="off"
          onChange={(e) => setForm({ ...form, username: e.target.value })}
        />
        <div className="relative">
          <input
            className={`${inputClass} pr-14`}
            type={showFormPassword ? "text" : "password"}
            placeholder={editingId ? "New password (blank = keep)" : "Password"}
            aria-label="Password"
            value={form.password}
            maxLength={200}
            autoComplete="new-password"
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-white"
            onClick={() => setShowFormPassword((v) => !v)}
          >
            {showFormPassword ? "Hide" : "Show"}
          </button>
        </div>
        <input
          className={inputClass}
          placeholder="Notes (optional)"
          aria-label="Notes"
          value={form.notes}
          maxLength={300}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
        <input
          className={`${inputClass} lg:col-span-2`}
          inputMode="url"
          placeholder="Admin panel link (optional)"
          aria-label="Admin panel link"
          value={form.adminUrl}
          maxLength={500}
          onChange={(e) => setForm({ ...form, adminUrl: e.target.value })}
        />
        <input
          className={`${inputClass} lg:col-span-2`}
          inputMode="url"
          placeholder="Game link (optional)"
          aria-label="Game link"
          value={form.gameUrl}
          maxLength={500}
          onChange={(e) => setForm({ ...form, gameUrl: e.target.value })}
        />
        <div className="flex gap-2">
          <Button type="submit" loading={busy} disabled={!form.username.trim() || (!editingId && !form.password)}>
            {editingId ? "Save login" : "Add login"}
          </Button>
          {editingId && (
            <Button type="button" variant="ghost" onClick={resetForm}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </div>
  );
};

export default GameLoginsPanel;
