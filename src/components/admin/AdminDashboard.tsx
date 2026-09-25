import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Page, Card, StatCard, Banner, Button, Table, Th, Td, Pagination, Modal, inputClass } from "../ui/ui";
import FilterBar from "./FilterBar";
import PaymentsTable from "./PaymentsTable";
import PaymentDetailModal from "./PaymentDetailModal";
import EditHistory from "./EditHistory";
import GamesTab from "./GamesTab";
import AuditTab from "./AuditTab";
import { DeleteUserModal, EditUserModal, ManagedUser } from "./UserModals";
import {
  adminCreateUser,
  adminUpdateUserRole,
  Role,
  adminGames,
  adminPayments,
  adminUsers,
  clean,
  downloadPaymentsCsv,
  GameOption,
  GameSummaryRow,
  Paged,
  PaymentFilters,
  PaymentRow,
  ADMIN_PAGE_SIZE,
  adminPaymentsParams,
  Totals,
  UserRow,
} from "../../lib/paymentsApi";
import { errorMessage } from "../../lib/http";
import { peekCached, updateCached, useCachedGet, useDropTick } from "../../lib/cache";
import { mergeChanges, useDeltaSync, ChangedRow } from "../../lib/deltaSync";
import { formatCents } from "../../utils/money";

type Tab = "overview" | "payments" | "users" | "games" | "audit";
const TABS: [Tab, string][] = [
  ["overview", "Overview"],
  ["payments", "Payments"],
  ["users", "Users"],
  ["games", "Games"],
  ["audit", "Audit Log"],
];
const FILTER_KEYS: (keyof PaymentFilters)[] = ["dateFrom", "dateTo", "gameId", "search"];

/** Filters live in the URL so views are shareable and survive reloads. */
const useUrlState = () => {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "overview";
  const userId = params.get("user") || undefined;
  const filters = useMemo(() => {
    const f: PaymentFilters = {};
    FILTER_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) f[k] = v;
    });
    return f;
  }, [params]);

  const update = useCallback(
    (next: { tab?: Tab; user?: string | null; filters?: PaymentFilters }) => {
      const p = new URLSearchParams();
      p.set("tab", next.tab || tab);
      const user = next.user === undefined ? userId : next.user;
      if (user) p.set("user", user);
      const f = next.filters || filters;
      FILTER_KEYS.forEach((k) => f[k] && p.set(k, f[k] as string));
      setParams(p);
    },
    [tab, userId, filters, setParams]
  );
  return { tab, userId, filters, update };
};

// Summaries come from the cache; a pushed change to their data refetches them by itself
const OverviewTab: React.FC<{ filters: PaymentFilters }> = ({ filters }) => {
  const params = clean({ ...filters });
  const s = useCachedGet<Totals & { totalUsers: number }>("/admin/summary", params);
  const g = useCachedGet<GameSummaryRow[]>("/admin/games/summary", params);
  const summary = s.data || null;
  const games = g.data || null;
  const error = s.error || g.error ? errorMessage(s.error || g.error, "Could not load summary") : "";

  const v = (n?: number) => (summary ? (n ?? 0).toLocaleString() : "—");
  return (
    <div className="space-y-6">
      {error && <Banner>{error}</Banner>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Users" tone="purple" value={v(summary?.totalUsers)} />
        <StatCard label="Total Entries" tone="gray" value={v(summary?.count)} />
        <StatCard label="Total Deposit" tone="green" value={summary ? formatCents(summary.totalDeposit) : "—"} />
        <StatCard label="Total Loaded" tone="blue" value={summary ? formatCents(summary.totalLoaded) : "—"} />
        <StatCard label="Total Redeemed" tone="purple" value={summary ? formatCents(summary.totalRedeemed || 0) : "—"} />
        <StatCard label="Edited Entries" tone="yellow" value={v(summary?.edited)} />
      </div>
      <Card title="Totals by Game">
        <Table
          loading={!games && !error}
          empty={!!games && games.length === 0}
          head={
            <>
              <Th>Game</Th>
              <Th right>Entries</Th>
              <Th right>Deposit</Th>
              <Th right>Loaded</Th>
              <Th right>Redeemed</Th>
              <Th right>Edited</Th>
            </>
          }
        >
          {games?.map((g) => (
            <tr key={g.gameId} className="hover:bg-white/5">
              <Td className="font-medium text-white">
                {g.game}
                {!g.active && <span className="ml-2 text-xs text-gray-500">(disabled)</span>}
              </Td>
              <Td right>{g.count.toLocaleString()}</Td>
              <Td right>{formatCents(g.totalDeposit)}</Td>
              <Td right>{formatCents(g.totalLoaded)}</Td>
              <Td right>{formatCents(g.totalRedeemed || 0)}</Td>
              <Td right>{(g.edited ?? 0).toLocaleString()}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
};

// Permanent deletes in the detail modal are broadcast here so every visible list drops the row at once
const paymentPatches = new EventTarget();
const broadcastDelete = (id: string) => paymentPatches.dispatchEvent(new CustomEvent("delete", { detail: id }));

// Parent passes key={filters} so new filters remount at page 1 without a duplicate request
const PaymentsList: React.FC<{
  filters: PaymentFilters;
  onOpen: (id: string) => void;
  showUser?: boolean;
}> = ({ filters, onOpen, showUser }) => {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<PaymentRow> | null>(
    () => peekCached<Paged<PaymentRow>>("/admin/payments", adminPaymentsParams(filters, 1)) || null
  );
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState("");
  const dataRef = useRef(data);
  dataRef.current = data;

  const load = useCallback(() => {
    let cancelled = false;
    const cached = peekCached<Paged<PaymentRow>>("/admin/payments", adminPaymentsParams(filters, page));
    if (cached) setData(cached);
    setLoading(!cached);
    setError("");
    adminPayments(filters, page)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(errorMessage(e, "Could not load payments")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filters, page]);
  useEffect(load, [load]);

  const apply = useCallback(
    (changes: (PaymentRow & ChangedRow)[]) => {
      setData((prev) => {
        if (!prev) return prev;
        const merged = mergeChanges(prev, changes, { limit: ADMIN_PAGE_SIZE, loadedAt: prev.sync?.cursor });
        const next = { ...prev, ...merged, pages: Math.max(1, Math.ceil(merged.total / ADMIN_PAGE_SIZE)) };
        updateCached("/admin/payments", adminPaymentsParams(filters, page), () => next);
        return next;
      });
    },
    [filters, page]
  );

  // Permanent delete: drop the row everywhere at once
  useEffect(() => {
    const onDelete = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const row = dataRef.current?.items.find((r) => r.id === id);
      if (row) apply([{ ...row, createdAt: "", deleted: true, match: false }]);
    };
    paymentPatches.addEventListener("delete", onDelete);
    return () => paymentPatches.removeEventListener("delete", onDelete);
  }, [apply]);

  // Background delta sync: only changed rows are downloaded
  useDeltaSync<PaymentRow>({
    url: "/admin/payments/changes",
    list: { url: "/admin/payments", params: adminPaymentsParams(filters, page) },
    params: filters as Record<string, unknown>,
    sync: data?.sync,
    onChanges: apply,
    onReset: load,
  });

  return (
    <>
      {error && <div className="mb-3"><Banner>{error}</Banner></div>}
      <PaymentsTable data={data} loading={loading} onOpen={onOpen} onPage={setPage} showUser={showUser} />
    </>
  );
};

const RoleBadge: React.FC<{ role?: Role }> = ({ role }) => (
  <span
    className={`text-xs px-2 py-0.5 rounded-full border ${
      role === "admin" ? "border-red-500/50 text-red-300" : "border-gray-600 text-gray-400"
    }`}
  >
    {role === "admin" ? "Admin" : "User"}
  </span>
);

const CreateUserForm: React.FC<{ onCreated: (u: UserRow) => void }> = ({ onCreated }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [adminAuth, setAdminAuth] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (username.trim().length < 3) return setMessage({ tone: "error", text: "Username must be at least 3 characters" });
    if (password.length < 6) return setMessage({ tone: "error", text: "Password must be at least 6 characters" });
    if (role === "admin" && !adminAuth) return setMessage({ tone: "error", text: "Enter the admin auth code to create an admin" });
    setBusy(true);
    setMessage(null);
    try {
      const u = await adminCreateUser({ username: username.trim(), password, role, ...(role === "admin" ? { adminAuth } : {}) });
      onCreated(u);
      setMessage({ tone: "ok", text: `Created ${u.role === "admin" ? "admin" : "user"} "${u.username}"` });
      setUsername("");
      setPassword("");
      setRole("user");
      setAdminAuth("");
    } catch (err) {
      setMessage({ tone: "error", text: errorMessage(err, "Could not create user") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Create User">
      <form onSubmit={onSubmit} className="flex flex-wrap gap-2 items-center">
        <input
          className={`${inputClass} max-w-xs`}
          placeholder="Username"
          value={username}
          maxLength={30}
          autoComplete="off"
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          type="password"
          className={`${inputClass} max-w-xs`}
          placeholder="Password (min 6)"
          value={password}
          autoComplete="new-password"
          onChange={(e) => setPassword(e.target.value)}
        />
        <select className={`${inputClass} w-36`} value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role">
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
        {role === "admin" && (
          <input
            type="password"
            className={`${inputClass} max-w-xs`}
            placeholder="Admin auth code"
            value={adminAuth}
            autoComplete="off"
            onChange={(e) => setAdminAuth(e.target.value)}
          />
        )}
        <Button type="submit" loading={busy} disabled={!username.trim() || !password || (role === "admin" && !adminAuth)}>
          Create
        </Button>
      </form>
      {role === "admin" && <p className="text-xs text-yellow-400 mt-2">Admins can sign in to this console and manage all users and payments.</p>}
      {message && (
        <div className="mt-3">
          <Banner tone={message.tone}>{message.text}</Banner>
        </div>
      )}
    </Card>
  );
};

const UsersTab: React.FC<{ onSelect: (id: string) => void }> = ({ onSelect }) => {
  const { user: me } = useAuth();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<UserRow> | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const patchRow = (id: string, patch: Partial<UserRow>) =>
    setData((prev) => (prev ? { ...prev, items: prev.items.map((u) => (u.id === id ? { ...u, ...patch } : u)) } : prev));

  // A role change is confirmed with the admin auth code in a dialog
  const [roleChange, setRoleChange] = useState<{ user: UserRow; next: Role } | null>(null);
  const [authCode, setAuthCode] = useState("");
  const [roleError, setRoleError] = useState("");

  const toggleRole = (u: UserRow) => {
    setRoleChange({ user: u, next: u.role === "admin" ? "user" : "admin" });
    setAuthCode("");
    setRoleError("");
  };
  const closeRoleChange = useCallback(() => {
    if (!busyId) setRoleChange(null);
  }, [busyId]);

  const confirmRoleChange = async (e: FormEvent) => {
    e.preventDefault();
    if (!roleChange || !authCode) return;
    const { user: u, next } = roleChange;
    setBusyId(u.id);
    setRoleError("");
    setError("");
    try {
      const res = await adminUpdateUserRole(u.id, next, authCode);
      patchRow(u.id, { role: res.role });
      setRoleChange(null);
    } catch (err) {
      setRoleError(errorMessage(err, "Could not change role"));
    } finally {
      setBusyId(null);
    }
  };

  const [editUser, setEditUser] = useState<ManagedUser | null>(null);
  const [deleteUser, setDeleteUser] = useState<ManagedUser | null>(null);
  const onDeleted = (id: string) =>
    setData((prev) => (prev ? { ...prev, items: prev.items.filter((u) => u.id !== id), total: Math.max(0, prev.total - 1) } : prev));

  const onCreated = (u: UserRow) =>
    setData((prev) => (prev ? { ...prev, items: [u, ...prev.items], total: prev.total + 1 } : prev));

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Refetch when the list's data changes (pushed), e.g. an entry or account elsewhere
  const changed = useDropTick("/admin/users", clean({ search: debounced, page }));
  useEffect(() => {
    if (!changed) setData(null);
    adminUsers(debounced, page)
      .then(setData)
      .catch((e) => setError(errorMessage(e, "Could not load users")));
  }, [debounced, page, changed]);

  return (
    <div className="space-y-6">
      <CreateUserForm onCreated={onCreated} />
      <EditUserModal
        user={editUser}
        isMe={!!editUser && String(me?.id) === String(editUser.id)}
        onClose={() => setEditUser(null)}
        onSaved={(u) => patchRow(u.id, { username: u.username })}
      />
      <DeleteUserModal user={deleteUser} onClose={() => setDeleteUser(null)} onDeleted={onDeleted} />
      <Modal
        open={!!roleChange}
        onClose={closeRoleChange}
        title={roleChange?.next === "admin" ? "Make admin" : "Remove admin access"}
      >
        {roleChange && (
          <form onSubmit={confirmRoleChange} className="space-y-4">
            <p className="text-gray-300 text-sm">
              {roleChange.next === "admin" ? "Give " : "Remove admin access from "}
              <span className="text-white font-semibold">{roleChange.user.username}</span>
              {roleChange.next === "admin" ? " admin access? Admins can manage all users and payments." : "? They will become a regular user."}
            </p>
            <label className="block">
              <span className="block text-sm text-gray-400 mb-1">Admin auth code</span>
              <input
                type="password"
                className={inputClass}
                value={authCode}
                autoFocus
                autoComplete="off"
                onChange={(e) => setAuthCode(e.target.value)}
              />
            </label>
            {roleError && <Banner>{roleError}</Banner>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeRoleChange} disabled={!!busyId}>
                Cancel
              </Button>
              <Button type="submit" loading={!!busyId} disabled={!authCode}>
                {roleChange.next === "admin" ? "Make admin" : "Make user"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
      <Card
        title="Users"
        actions={<input className={`${inputClass} w-56`} placeholder="Search username" value={search} onChange={(e) => setSearch(e.target.value)} />}
      >
        {error && <div className="mb-3"><Banner>{error}</Banner></div>}
        <Table
          loading={!data && !error}
          empty={!!data && data.items.length === 0}
          head={
            <>
              <Th>User</Th>
              <Th>Role</Th>
              <Th right>Entries</Th>
              <Th right>Deposit</Th>
              <Th right>Loaded</Th>
              <Th right>Redeemed</Th>
              <Th right>Edited</Th>
              <Th right>Actions</Th>
            </>
          }
        >
          {data?.items.map((u) => {
            const isMe = String(me?.id) === String(u.id);
            return (
              <tr key={u.id} className="hover:bg-white/5 cursor-pointer" onClick={() => onSelect(u.id)}>
                <Td className="font-medium text-white">
                  {u.username}
                  {isMe && <span className="ml-2 text-xs text-gray-500">(you)</span>}
                </Td>
                <Td>
                  <RoleBadge role={u.role} />
                </Td>
                <Td right>{u.count.toLocaleString()}</Td>
                <Td right>{formatCents(u.totalDeposit)}</Td>
                <Td right>{formatCents(u.totalLoaded)}</Td>
                <Td right>{formatCents(u.totalRedeemed || 0)}</Td>
                <Td right>{u.edited ?? 0}</Td>
                <Td right>
                  <div className="flex gap-2 justify-end">
                  <Button
                    variant="ghost"
                    className="px-3 py-1 text-sm"
                    disabled={busyId !== null}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditUser(u);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-3 py-1 text-sm whitespace-nowrap"
                    loading={busyId === u.id}
                    disabled={isMe || busyId !== null}
                    title={isMe ? "You cannot change your own role" : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleRole(u);
                    }}
                  >
                    {u.role === "admin" ? "Make user" : "Make admin"}
                  </Button>
                  <Button
                    variant="danger"
                    className="px-3 py-1 text-sm"
                    disabled={isMe || busyId !== null}
                    title={isMe ? "You cannot delete your own account" : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteUser(u);
                    }}
                  >
                    Delete
                  </Button>
                  </div>
                </Td>
              </tr>
            );
          })}
        </Table>
        {data && data.total > 0 && <Pagination page={data.page} pages={data.pages} total={data.total} onChange={setPage} />}
      </Card>
    </div>
  );
};

const UserDetail: React.FC<{
  userId: string;
  filters: PaymentFilters;
  games: GameOption[];
  onFilters: (f: PaymentFilters) => void;
  onBack: () => void;
  onOpen: (id: string) => void;
}> = ({ userId, filters, games, onFilters, onBack, onOpen }) => {
  const summary = useCachedGet<UserRow>(`/admin/users/${userId}/summary`);
  const user = summary.data || null;
  const error = summary.error ? errorMessage(summary.error, "Could not load user") : "";
  const userFilters = useMemo(() => ({ ...filters, search: undefined, userId }), [filters, userId]);
  const { user: me } = useAuth();
  const isMe = String(me?.id) === String(userId);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={onBack}>
          ← All users
        </Button>
        <h2 className="text-2xl font-bold">{user?.username || "User"}</h2>
        {user && <RoleBadge role={user.role} />}
        {user && (
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" className="px-3 py-1" onClick={() => setEditing(true)}>
              Edit user
            </Button>
            <Button
              variant="danger"
              className="px-3 py-1"
              disabled={isMe}
              title={isMe ? "You cannot delete your own account" : undefined}
              onClick={() => setDeleting(true)}
            >
              Delete user
            </Button>
          </div>
        )}
      </div>
      {/* The summary refetches on its own after an edit (the admin user caches are invalidated) */}
      <EditUserModal user={editing ? user : null} isMe={isMe} onClose={() => setEditing(false)} onSaved={() => {}} />
      <DeleteUserModal user={deleting ? user : null} onClose={() => setDeleting(false)} onDeleted={onBack} />
      {error && <Banner>{error}</Banner>}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Entries" value={user ? user.count : "—"} />
        <StatCard label="Deposit" tone="green" value={user ? formatCents(user.totalDeposit) : "—"} />
        <StatCard label="Loaded" tone="blue" value={user ? formatCents(user.totalLoaded) : "—"} />
        <StatCard label="Redeemed" tone="purple" value={user ? formatCents(user.totalRedeemed || 0) : "—"} />
        <StatCard label="Edited Entries" tone="yellow" value={user ? user.edited ?? 0 : "—"} />
      </div>
      <Card title="Payment History">
        <div className="mb-4">
          <FilterBar filters={filters} onChange={onFilters} games={games} showUserSearch={false} />
        </div>
        <PaymentsList
          key={JSON.stringify(userFilters)}
          filters={userFilters}
          onOpen={onOpen}
          showUser={false}
        />
      </Card>
      {/* Every edit this user made to their entries: what changed and when */}
      <EditHistory userId={userId} onOpen={onOpen} />
    </div>
  );
};

const AdminDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { tab, userId, filters, update } = useUrlState();
  const [games, setGames] = useState<GameOption[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  // Admin filter dropdown includes disabled games so historical data stays filterable
  const loadGames = useCallback(() => {
    adminGames()
      .then((gs) => setGames(gs.map((g) => ({ id: g.id, name: g.active ? g.name : `${g.name} (disabled)` }))))
      .catch(() => {});
  }, []);
  // Refetched only when the server pushes a change to the games
  const gamesChanged = useDropTick("/admin/games");
  useEffect(loadGames, [loadGames, gamesChanged]);

  const onExport = async () => {
    setExporting(true);
    setError("");
    try {
      await downloadPaymentsCsv(filters);
    } catch (e) {
      setError(errorMessage(e, "Export failed"));
    } finally {
      setExporting(false);
    }
  };

  const setFilters = (f: PaymentFilters) => update({ filters: f });

  return (
    <Page>
      <div className="sticky top-0 z-30 bg-gradient-to-r from-gray-900 to-black border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 md:px-8 pt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold">Admin Console</h1>
            <p className="text-gray-400 text-sm">Signed in as {user?.username}</p>
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              logout();
              navigate("/admin/login");
            }}
          >
            Logout
          </Button>
        </div>
        <nav className="max-w-7xl mx-auto px-4 md:px-8 flex gap-1 overflow-x-auto mt-3">
          {TABS.map(([t, label]) => (
            <button
              key={t}
              onClick={() => update({ tab: t, user: null })}
              className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                tab === t ? "border-red-500 text-white" : "border-transparent text-gray-400 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 space-y-6">
        {error && <Banner>{error}</Banner>}

        {(tab === "overview" || tab === "payments") && (
          <Card>
            <FilterBar filters={filters} onChange={setFilters} games={games} onExport={onExport} exporting={exporting} />
          </Card>
        )}

        {tab === "overview" && <OverviewTab filters={filters} />}
        {tab === "overview" && (
          <Card title="Recent Payments" actions={<Button variant="ghost" onClick={() => update({ tab: "payments" })}>View all</Button>}>
            <PaymentsList key={JSON.stringify(filters)} filters={filters} onOpen={setOpenId} />
          </Card>
        )}
        {tab === "payments" && (
          <Card title="All Payments">
            <PaymentsList key={JSON.stringify(filters)} filters={filters} onOpen={setOpenId} />
          </Card>
        )}
        {tab === "users" &&
          (userId ? (
            <UserDetail
              userId={userId}
              filters={filters}
              games={games}
              onFilters={setFilters}
              onBack={() => update({ user: null, filters: {} })}
              onOpen={setOpenId}
            />
          ) : (
            <UsersTab onSelect={(id) => update({ user: id, filters: {} })} />
          ))}
        {tab === "games" && <GamesTab onChanged={loadGames} />}
        {tab === "audit" && <AuditTab />}
      </div>

      <PaymentDetailModal
        paymentId={openId}
        onClose={() => setOpenId(null)}
        onDeleted={broadcastDelete}
      />
    </Page>
  );
};

export default AdminDashboard;
