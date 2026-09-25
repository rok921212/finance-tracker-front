import http from "./http";
import { cachedGet, invalidateCached } from "./cache";
import type { SyncToken } from "./deltaSync";

export interface GameOption {
  id: string;
  name: string;
  /** Points pool in cents; null = unlimited */
  totalPoints?: number | null;
  /** Points left in the pool in cents; null = unlimited */
  remaining?: number | null;
}

export type PaymentMethod = "cashapp" | "venmo" | "paypal" | "zelle" | "applepay" | "chime";

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cashapp", label: "Cash App" },
  { value: "venmo", label: "Venmo" },
  { value: "paypal", label: "PayPal" },
  { value: "zelle", label: "Zelle" },
  { value: "applepay", label: "Apple Pay" },
  { value: "chime", label: "Chime" },
];

export const paymentMethodLabel = (m?: string | null) =>
  PAYMENT_METHODS.find((x) => x.value === m)?.label || "—";

export interface PaymentRow {
  id: string;
  date: string;
  game: string | null;
  deposit: number; // cents
  loaded: number; // cents
  redeemed: number; // cents
  /** Cashout amount, cents (0 when none) */
  cashout: number;
  /** Older entries have none */
  paymentMethod: PaymentMethod | null;
  /** Name the player used to load points */
  player: string | null;
  /** Last time the user edited the entry (none = never edited) */
  editedAt?: string;
  /** Admin view only: when the user deleted the entry on their side (it still exists for the admin) */
  userDeletedAt?: string;
  thumb: string | null;
  /** Thumbnail of the optional cashout screenshot */
  cashoutThumb?: string | null;
  user?: { id: string; username: string };
}

export interface PaymentDetail extends PaymentRow {
  /** Present on the user's own entry detail (used to prefill the edit form) */
  gameId?: string;
  screenshot: string | null;
  /** Optional cashout screenshot (full size) */
  cashoutProof?: string | null;
  createdAt: string;
  sameScreenshot?: { id: string; userId: string; date: string }[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
  /** Present on payment lists: token for fetching only later changes */
  sync?: SyncToken;
}

/** One field a user changed in an edit. Money is in cents, dates are YYYY-MM-DD, images are "added" / "replaced". */
export interface EditChange {
  field: string;
  from: string | number | null;
  to: string | number | null;
}

/** One user edit of an entry: what changed and when */
export interface EditRow {
  id: string;
  paymentId: string;
  /** The entry's current date and game, for context */
  paymentDate: string | null;
  game: string | null;
  user: { id: string; username: string } | null;
  changes: EditChange[];
  createdAt: string;
}

export interface Totals {
  count: number;
  totalDeposit: number;
  totalLoaded: number;
  totalRedeemed: number;
  /** Entries the user has edited at least once */
  edited: number;
}

export interface MySummary {
  totalDeposit: number;
  totalLoaded: number;
  totalRedeemed: number;
  totalCashout: number;
  /** Total redeemed per game, highest first */
  redeemedByGame: { gameId: string; game: string | null; redeemed: number }[];
}

export type Role = "user" | "admin";

export interface UserRow extends Totals {
  id: string;
  username: string;
  role: Role;
  createdAt: string;
}

export interface GameSummaryRow extends Totals {
  gameId: string;
  game: string;
  active: boolean;
}

export interface AdminGame {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  sortOrder: number;
  /** Points pool in cents; null = unlimited */
  totalPoints: number | null;
  /** Loaded amount of every entry for this game */
  used: number;
  /** Redeemed amount of every entry for this game; goes back into the pool */
  redeemed: number;
  /** totalPoints - used + redeemed */
  remaining: number | null;
}

export interface AuditRow {
  id: string;
  admin: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface PaymentFilters {
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  gameId?: string;
  search?: string;
  paymentMethod?: string;
  /** Player name (prefix match) */
  player?: string;
}

// Drop empty values so the backend only sees real filters
export const clean = (params: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));

// All GETs go through the ETag cache: unchanged data costs a bodiless 304.
// ---- user ----
export const getActiveGames = () => cachedGet<GameOption[]>("/games");

/**
 * After ANY payment write: drop every cached payment list/summary/detail (user and admin, in all
 * open tabs) so nothing stale is shown, and nudge open pages to delta-sync right away.
 */
const paymentsChanged = () => invalidateCached("/payments", "/admin/", "/games");

export const createPayment = async (form: FormData, onProgress?: (pct: number) => void) => {
  const res = await http.post<{ message: string; payment: { id: string } }>("/payments", form, {
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
  paymentsChanged();
  return res.data;
};

export const MY_PAGE_SIZE = 18; // fills a 3- or 2-column card grid evenly
export type MySort = "date" | "deposit" | "loaded" | "redeemed" | "cashout" | "player";

/** How the user's list is shown. Empty = newest first, all players. */
export interface MyListView {
  sort?: MySort;
  order?: "asc" | "desc";
  /** Exact player name (any case) */
  player?: string;
}

/** True when the list is in its default order with no filter (live updates can be merged in place). */
export const isDefaultView = (view: MyListView = {}) => (!view.sort || view.sort === "date") && !view.order && !view.player;

// Only non-default values are sent, so the default view keeps one cache key
export const myPaymentsParams = (page: number, view: MyListView = {}) => ({
  page,
  limit: MY_PAGE_SIZE,
  ...(view.sort && view.sort !== "date" ? { sort: view.sort } : {}),
  ...(view.order ? { order: view.order } : {}),
  ...(view.player ? { player: view.player } : {}),
});
export const getMyPayments = (page: number, view?: MyListView) =>
  cachedGet<Paged<PaymentRow>>("/payments", myPaymentsParams(page, view), { deltaPrefix: "payments" });

/** Totals; with a player, only that player's entries are counted. */
export const getMySummary = (player?: string) =>
  cachedGet<MySummary>("/payments/summary", player ? { player } : undefined);

/** Single entry including the full-size screenshot URL (list rows only carry a thumbnail). */
export const getMyPayment = (id: string) => cachedGet<PaymentDetail>(`/payments/${id}`);

/** Edit an own entry (the change is logged for the admin); omitting screenshot / cashoutProof keeps the current ones. */
export const updatePayment = async (id: string, form: FormData, onProgress?: (pct: number) => void) => {
  const res = await http.patch<{ message: string; payment: PaymentDetail }>(`/payments/${id}`, form, {
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
  paymentsChanged();
  return res.data;
};

/** Hides the entry from this user. The admin keeps it (flagged) and alone can delete it for good. */
export const deleteMyPayment = async (id: string) => {
  const res = await http.delete<{ message: string; id: string }>(`/payments/${id}`);
  paymentsChanged();
  return res.data;
};

// ---- admin ----
export const adminSummary = (f: PaymentFilters) =>
  cachedGet<Totals & { totalUsers: number }>("/admin/summary", clean({ ...f }));

export const ADMIN_PAGE_SIZE = 50;
export const adminPaymentsParams = (f: PaymentFilters, page: number) => clean({ ...f, page, limit: ADMIN_PAGE_SIZE });
export const adminPayments = (f: PaymentFilters, page: number) =>
  cachedGet<Paged<PaymentRow>>("/admin/payments", adminPaymentsParams(f, page), { deltaPrefix: "payments" });

export const adminPayment = (id: string) => cachedGet<PaymentDetail>(`/admin/payments/${id}`);

/** Users' edit history (what changed, when), newest first; filter by user and/or entry. */
export const adminEdits = (f: { userId?: string; paymentId?: string }, page: number) =>
  cachedGet<Paged<EditRow>>("/admin/edits", clean({ ...f, page }));

/** Permanent delete (admin only). */
export const adminDeletePayment = async (id: string) => {
  const res = await http.delete<{ message: string; id: string }>(`/admin/payments/${id}`);
  paymentsChanged();
  return res.data;
};

export const adminUsers = (search: string, page: number) =>
  cachedGet<Paged<UserRow>>("/admin/users", clean({ search, page }));

export const adminUserSummary = (id: string) => cachedGet<UserRow>(`/admin/users/${id}/summary`);

// User writes change admin user lists/totals and the audit log
const usersChanged = () => invalidateCached("/admin/");
/** Creating an admin needs the admin auth code (adminAuth); plain users do not. */
export const adminCreateUser = async (body: { username: string; password: string; role: Role; adminAuth?: string }) => {
  const u = (await http.post<UserRow>("/admin/users", body)).data;
  usersChanged();
  return u;
};
/** Granting or removing admin access needs the admin auth code. */
export const adminUpdateUserRole = async (id: string, role: Role, adminAuth: string) => {
  const u = (await http.patch<Pick<UserRow, "id" | "username" | "role">>(`/admin/users/${id}/role`, { role, adminAuth })).data;
  usersChanged();
  return u;
};
/**
 * Rename and/or reset the password (blank password = keep it). Changing an admin account needs the
 * admin auth code. A password reset signs that user out everywhere.
 */
export const adminUpdateUser = async (id: string, body: { username?: string; password?: string; adminAuth?: string }) => {
  const u = (await http.patch<Pick<UserRow, "id" | "username" | "role">>(`/admin/users/${id}`, body)).data;
  usersChanged();
  return u;
};
/** Permanently deletes the user and all their entries. Deleting an admin needs the admin auth code. */
export const adminDeleteUser = async (id: string, adminAuth?: string) => {
  const res = (await http.delete<{ message: string; id: string; entries: number }>(`/admin/users/${id}`, { data: adminAuth ? { adminAuth } : {} })).data;
  usersChanged();
  paymentsChanged();
  return res;
};

export const adminGamesSummary = (f: PaymentFilters) =>
  cachedGet<GameSummaryRow[]>("/admin/games/summary", clean({ ...f }));

export const adminGames = () => cachedGet<AdminGame[]>("/admin/games");

// Game writes: game names/order show up in the dropdown, every payment list and the admin summaries
const gamesChanged = () => invalidateCached("/games", "/payments", "/admin/");
export const adminCreateGame = async (name: string) => {
  const g = (await http.post<AdminGame>("/admin/games", { name })).data;
  gamesChanged();
  return g;
};
export const adminUpdateGame = async (id: string, patch: Partial<Pick<AdminGame, "name" | "active">> & { totalPoints?: string | null }) => {
  const g = (await http.patch<AdminGame>(`/admin/games/${id}`, patch)).data;
  gamesChanged();
  return g;
};
/** Returns only the games whose order changed, as [id, sortOrder] pairs. */
export const adminMoveGame = async (id: string, direction: "up" | "down") => {
  const res = (await http.post<{ changed: [string, number][] }>(`/admin/games/${id}/move`, { direction })).data;
  gamesChanged();
  return res;
};

export const adminAudit = (page: number) => cachedGet<Paged<AuditRow>>("/admin/audit", { page });

export type ExportFormat = "csv" | "pdf";

/** Download the filtered export through the authenticated client so the token is never put in a URL. */
export const downloadPaymentsExport = async (f: PaymentFilters, format: ExportFormat) => {
  const res = await http.get(`/admin/payments/export.${format}`, { params: clean({ ...f }), responseType: "blob" });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payments-${new Date().toISOString().slice(0, 10)}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
