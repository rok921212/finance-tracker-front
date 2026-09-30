import React, { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Card, Button, Banner, Table, Th, Td, inputClass } from "../ui/ui";
import { adminCreateGame, adminGames, adminMoveGame, adminUpdateGame, AdminGame, GameSummaryRow } from "../../lib/paymentsApi";
import { errorMessage } from "../../lib/http";
import { useCachedGet, useDropTick } from "../../lib/cache";
import { formatCents } from "../../utils/money";

const GamesTab: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const [games, setGames] = useState<AdminGame[] | null>(null);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // All-time loaded / redeemed per game; refetched by itself when payments change
  const summary = useCachedGet<GameSummaryRow[]>("/admin/games/summary");
  const totalsByGame = useMemo(() => new Map((summary.data || []).map((r) => [String(r.gameId), r])), [summary.data]);

  const load = useCallback(() => {
    adminGames()
      .then(setGames)
      .catch((e) => setError(errorMessage(e, "Could not load games")));
  }, []);
  // Also refetch when the games change elsewhere (pushed by the server)
  const changed = useDropTick("/admin/games");
  useEffect(load, [load, changed]);

  const run = async (fn: () => Promise<unknown>, reload = true) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      if (reload) load();
      onChanged();
    } catch (e) {
      setError(errorMessage(e, "Action failed"));
    } finally {
      setBusy(false);
    }
  };

  const move = async (id: string, direction: "up" | "down") => {
    const { changed } = await adminMoveGame(id, direction);
    const order = new Map(changed);
    setGames((prev) =>
      prev
        ? prev
            .map((g) => (order.has(g.id) ? { ...g, sortOrder: order.get(g.id) as number } : g))
            .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        : prev
    );
  };

  // Create/rename/toggle return the full (small) game object: patch it into the list
  const upsert = (g: AdminGame) =>
    setGames((prev) => {
      if (!prev) return prev;
      const i = prev.findIndex((x) => x.id === g.id);
      return i >= 0 ? prev.map((x) => (x.id === g.id ? g : x)) : [...prev, g];
    });

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    run(async () => {
      upsert(await adminCreateGame(name.trim()));
      setName("");
    }, false);
  };

  return (
    <Card title="Game Management">
      <form onSubmit={onAdd} className="flex flex-wrap gap-2 mb-4">
        <input className={`${inputClass} max-w-xs`} placeholder="New game name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" loading={busy} disabled={!name.trim()}>
          Add Game
        </Button>
      </form>
      <p className="text-xs text-gray-500 mb-3">
        Disabled games are hidden from new entries but stay attached to historical payments. Loaded and Redeemed are
        all-time totals across every entry for the game. Games users type with "Custom game" are added here as
        disabled; enable one to offer it in everyone's dropdown.
      </p>
      {error && <div className="mb-3"><Banner>{error}</Banner></div>}
      <Table
        loading={!games && !error}
        empty={!!games && games.length === 0}
        head={
          <>
            <Th>Order</Th>
            <Th>Name</Th>
            <Th right>Entries</Th>
            <Th right>Loaded</Th>
            <Th right>Redeemed</Th>
            <Th>Status</Th>
            <Th right>Actions</Th>
          </>
        }
      >
        {games?.map((g, i) => {
          const t = totalsByGame.get(g.id);
          return (
            <tr key={g.id} className="hover:bg-white/5">
              <Td>
                <div className="flex gap-1">
                  <button
                    className="px-2 rounded bg-gray-700/60 disabled:opacity-30"
                    disabled={busy || i === 0}
                    onClick={() => run(() => move(g.id, "up"), false)}
                    aria-label={`Move ${g.name} up`}
                  >
                    ↑
                  </button>
                  <button
                    className="px-2 rounded bg-gray-700/60 disabled:opacity-30"
                    disabled={busy || i === games.length - 1}
                    onClick={() => run(() => move(g.id, "down"), false)}
                    aria-label={`Move ${g.name} down`}
                  >
                    ↓
                  </button>
                </div>
              </Td>
              <Td className="text-white font-medium">
                {editing?.id === g.id ? (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(async () => {
                        upsert(await adminUpdateGame(g.id, { name: editing.name.trim() }));
                        setEditing(null);
                      }, false);
                    }}
                  >
                    <input className={inputClass} value={editing.name} maxLength={60} autoFocus onChange={(e) => setEditing({ id: g.id, name: e.target.value })} />
                    <Button type="submit" className="px-3 py-1" loading={busy}>
                      Save
                    </Button>
                    <Button type="button" variant="ghost" className="px-3 py-1" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </form>
                ) : (
                  g.name
                )}
              </Td>
              <Td right>{summary.data ? t?.count ?? 0 : "—"}</Td>
              <Td right className="text-blue-300">{summary.data ? formatCents(t?.totalLoaded ?? 0) : "—"}</Td>
              <Td right className="text-purple-300">{summary.data ? formatCents(t?.totalRedeemed ?? 0) : "—"}</Td>
              <Td>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${g.active ? "border-green-500/40 text-green-300" : "border-gray-600 text-gray-400"}`}>
                  {g.active ? "Active" : "Disabled"}
                </span>
              </Td>
              <Td right>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" className="px-3 py-1" disabled={busy} onClick={() => setEditing({ id: g.id, name: g.name })}>
                    Rename
                  </Button>
                  <Button
                    variant={g.active ? "danger" : "success"}
                    className="px-3 py-1"
                    disabled={busy}
                    onClick={() => run(async () => upsert(await adminUpdateGame(g.id, { active: !g.active })), false)}
                  >
                    {g.active ? "Disable" : "Enable"}
                  </Button>
                </div>
              </Td>
            </tr>
          );
        })}
      </Table>
    </Card>
  );
};

export default GamesTab;
