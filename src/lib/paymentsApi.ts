import http from "./http";
import { cachedGet, invalidateCached, peekCached, updateCached, CacheOptions } from "./cache";
import type { SyncToken } from "./deltaSync";

// Reads show any cached copy at once and refresh it in the background (see cachedGet `swr`)
const SWR: CacheOptions = { swr: true };
// Public pages have no live stream: trust a copy for a minute, then re-check it in the background
const PUBLIC: CacheOptions = { swr: true, maxAge: 60 };

export interface GameOption {
  id: string;
  name: string;
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
  /** Method the cashout was paid out with; null when there is no cashout (or on older entries) */
  cashoutMethod: PaymentMethod | null;
  /** Optional free-text notes about the entry */
  notes: string | null;
  /** Name the player used to load points */
  player: string | null;
  /** Game-backend username the points were loaded from; older entries have none */
  gameUsername: string | null;
  /** Tag of the account the money was sent to (e.g. $cashtag); older entries have none */
  paymentTag: string | null;
  /** Last time the user edited the entry (none = never edited) */
  editedAt?: string;
  /** Admin view only: when the user deleted the entry on their side (it still exists for the admin) */
  userDeletedAt?: string;
  thumb: string | null;
  /** Thumbnail of the optional cashout screenshot */
  cashoutThumb?: string | null;
  /** Full-size screenshot URLs (lists include them so a preview opens without another request) */
  shot?: string | null;
  cashoutShot?: string | null;
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

export interface GameAmount {
  gameId: string;
  game: string | null;
  amount: number; // cents
}

export interface MethodAmount {
  /** null for older entries saved without a payment method */
  method: PaymentMethod | null;
  amount: number; // cents
}

/** Card totals with their breakdowns (highest first); each breakdown sums to its total */
export interface SummaryBreakdowns {
  totalDeposit: number;
  totalLoaded: number;
  totalRedeemed: number;
  totalCashout: number;
  depositByMethod: MethodAmount[];
  loadedByGame: GameAmount[];
  redeemedByGame: GameAmount[];
  cashoutByMethod: MethodAmount[];
}

export type MySummary = SummaryBreakdowns;
export type AdminSummary = Totals & SummaryBreakdowns & { totalUsers: number };

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
  /** 600x600 tile for the public games page */
  imageUrl?: string | null;
}

export interface PublicGame {
  id: string;
  name: string;
  imageUrl: string | null;
}

export interface PublicBanner {
  imageUrl: string;
  link: string;
}

export interface AdminTag {
  id: string;
  method: PaymentMethod;
  handle: string;
  name: string;
  note: string;
  active: boolean;
  sortOrder: number;
  qrUrl: string | null;
}

export interface PublicTag {
  id: string;
  method: PaymentMethod;
  handle: string;
  name: string;
  note: string;
  qrUrl: string | null;
  /** Same QR served as a file download */
  qrDownloadUrl: string | null;
}

export interface AdminBanner {
  imageUrl: string | null;
  enabled: boolean;
  link: string;
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
  /** One or more payment methods, comma-separated */
  paymentMethod?: string;
  /** Player name (prefix match) */
  player?: string;
  /** One or more backend usernames, comma-separated (exact match, any case) */
  gameUsername?: string;
}

/** Comma-separated filter value <-> list of its parts */
export const splitList = (v?: string) => (v ? v.split(",").filter(Boolean) : []);
export const joinList = (list: string[]) => (list.length ? list.join(",") : undefined);

// Drop empty values so the backend only sees real filters
export const clean = (params: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));

// All GETs go through the ETag cache: unchanged data costs a bodiless 304.
// ---- user ----
export const getActiveGames = () => cachedGet<GameOption[]>("/games", undefined, SWR);

/**
 * After ANY payment write: drop every cached payment list/summary/detail (user and admin, in all
 * open tabs) so nothing stale is shown, and nudge open pages to delta-sync right away.
 */
// (The games list doesn't depend on payments, so it is kept)
const paymentsChanged = () => invalidateCached("/payments", "/admin/");

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
  cachedGet<MySummary>("/payments/summary", player ? { player } : undefined, SWR);

/** Single entry including the full-size screenshot URL (list rows only carry a thumbnail). */
export const getMyPayment = (id: string) => cachedGet<PaymentDetail>(`/payments/${id}`, undefined, SWR);

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

/**
 * Hides the entry from this user. The admin keeps it (flagged) and alone can delete it for good.
 * `list`: the page on screen. When it holds every row (nothing to pull up from a next page), only
 * the row is removed from its cached copy and just the totals/detail are refetched; otherwise every
 * list is dropped so the page refills from the server.
 */
export const deleteMyPayment = async (id: string, list?: { params: Record<string, unknown>; complete: boolean }) => {
  const res = await http.delete<{ message: string; id: string }>(`/payments/${id}`);
  if (list?.complete) {
    updateCached<Paged<PaymentRow>>("/payments", list.params, (d) => ({
      ...d,
      items: d.items.filter((x) => x.id !== id),
      total: Math.max(0, d.total - (d.items.some((x) => x.id === id) ? 1 : 0)),
    }));
    invalidateCached("/payments/summary", `/payments/${id}`, "/admin/");
  } else {
    paymentsChanged();
  }
  return res.data;
};

// ---- admin ----
export const adminSummary = (f: PaymentFilters) =>
  cachedGet<AdminSummary>("/admin/summary", clean({ ...f }), SWR);

export const ADMIN_PAGE_SIZE = 50;
export const adminPaymentsParams = (f: PaymentFilters, page: number) => clean({ ...f, page, limit: ADMIN_PAGE_SIZE });
export const adminPayments = (f: PaymentFilters, page: number) =>
  cachedGet<Paged<PaymentRow>>("/admin/payments", adminPaymentsParams(f, page), { deltaPrefix: "payments" });

export interface GameUsernameRow {
  name: string;
  count: number;
}
/**
 * GET /admin/payments/game-usernames -> GameUsernameRow[]: every backend username in use (case variants
 * merged), most used first. The username filter itself is left out so picking names doesn't shrink the list.
 */
export const GAME_USERNAMES_URL = "/admin/payments/game-usernames";
export const gameUsernamesParams = (f: PaymentFilters) => clean({ ...f, gameUsername: undefined });

export const adminPayment = (id: string) => cachedGet<PaymentDetail>(`/admin/payments/${id}`, undefined, SWR);

/** Users' edit history (what changed, when), newest first; filter by user and/or entry. */
export const adminEdits = (f: { userId?: string; paymentId?: string }, page: number) =>
  cachedGet<Paged<EditRow>>("/admin/edits", clean({ ...f, page }), SWR);

/** Permanent delete (admin only). */
export const adminDeletePayment = async (id: string) => {
  const res = await http.delete<{ message: string; id: string }>(`/admin/payments/${id}`);
  paymentsChanged();
  return res.data;
};

export const adminUsers = (search: string, page: number) =>
  cachedGet<Paged<UserRow>>("/admin/users", clean({ search, page }), SWR);

export const adminUserSummary = (id: string) => cachedGet<UserRow>(`/admin/users/${id}/summary`, undefined, SWR);

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
  cachedGet<GameSummaryRow[]>("/admin/games/summary", clean({ ...f }), SWR);

export const adminGames = () => cachedGet<AdminGame[]>("/admin/games", undefined, SWR);

// Game writes: game names/order show up in the dropdown, every payment list, the admin summaries
// and the public games page
const gamesChanged = () => invalidateCached("/games", "/payments", "/admin/", "/public/games");
export const adminCreateGame = async (name: string) => {
  const g = (await http.post<AdminGame>("/admin/games", { name })).data;
  gamesChanged();
  return g;
};
export const adminUpdateGame = async (id: string, patch: Partial<Pick<AdminGame, "name" | "active">>) => {
  const g = (await http.patch<AdminGame>(`/admin/games/${id}`, patch)).data;
  gamesChanged();
  return g;
};
const imageForm = (file: File) => {
  const form = new FormData();
  form.append("image", file);
  return form;
};
/** Any image: the server crops it to 600x600. */
export const adminUploadGameImage = async (id: string, file: File) => {
  const g = (await http.post<AdminGame>(`/admin/games/${id}/image`, imageForm(file))).data;
  gamesChanged();
  return g;
};
export const adminRemoveGameImage = async (id: string) => {
  const g = (await http.delete<AdminGame>(`/admin/games/${id}/image`)).data;
  gamesChanged();
  return g;
};

// ---- popup banner on the public games page ----
const bannerChanged = () => invalidateCached("/admin/banner", "/public/banner");
export const adminBanner = () => cachedGet<AdminBanner>("/admin/banner", undefined, SWR);
export const adminUploadBanner = async (file: File) => {
  const b = (await http.post<AdminBanner>("/admin/banner", imageForm(file))).data;
  bannerChanged();
  return b;
};
export const adminUpdateBanner = async (patch: Partial<Pick<AdminBanner, "enabled" | "link">>) => {
  const b = (await http.patch<AdminBanner>("/admin/banner", patch)).data;
  bannerChanged();
  return b;
};
export const adminDeleteBanner = async () => {
  const b = (await http.delete<AdminBanner>("/admin/banner")).data;
  bannerChanged();
  return b;
};

// ---- payment tags (public /tags page) ----
const tagsChanged = () => invalidateCached("/admin/tags", "/public/tags");
export const adminTags = () => cachedGet<AdminTag[]>("/admin/tags", undefined, SWR);
/** Multipart: method, handle, name, note and an optional `qr` image. */
export const adminCreateTag = async (form: FormData) => {
  const t = (await http.post<AdminTag>("/admin/tags", form)).data;
  tagsChanged();
  return t;
};
/** JSON patch, or multipart when replacing the QR (`qr` file) or removing it (removeQr=true). */
export const adminUpdateTag = async (id: string, patch: FormData | Partial<Pick<AdminTag, "method" | "handle" | "name" | "note" | "active">>) => {
  const t = (await http.patch<AdminTag>(`/admin/tags/${id}`, patch)).data;
  tagsChanged();
  return t;
};
export const adminDeleteTag = async (id: string) => {
  const res = (await http.delete<{ id: string }>(`/admin/tags/${id}`)).data;
  tagsChanged();
  return res;
};
/** Returns only the tags whose order changed, as [id, sortOrder] pairs. */
export const adminMoveTag = async (id: string, direction: "up" | "down") => {
  const res = (await http.post<{ changed: [string, number][] }>(`/admin/tags/${id}/move`, { direction })).data;
  tagsChanged();
  return res;
};

// ---- wheel of fortune (public /wheel page) ----
export interface WheelSegment {
  id: string;
  label: string;
  /** Free text, e.g. "$50" or "10 Free Spins"; "" = label only */
  amount: string;
  color: string;
  imageUrl: string | null;
}
export interface AdminWheelSegment extends WheelSegment {
  active: boolean;
  sortOrder: number;
}
export interface WheelConfig {
  enabled: boolean;
  title: string;
  subtitle: string;
  spinDurationSec: number;
  extraRotations: number;
  /** null = random among active segments */
  targetSegmentId: string | null;
  cooldownSec: number;
}
export interface PublicWheel extends Omit<WheelConfig, "targetSegmentId"> {
  segments: WheelSegment[];
}
export interface WheelSpinResult extends WheelSegment {
  segmentId: string;
  index: number;
  spinDurationSec: number;
}
export interface AdminWheel {
  config: WheelConfig;
  segments: AdminWheelSegment[];
  recentSpins: { id: string; segmentId: string; label: string; amount: string; forced: boolean; createdAt: string }[];
  limits: { minSegments: number; maxSegments: number };
}

const wheelChanged = () => invalidateCached("/admin/wheel", "/public/wheel");
export const getPublicWheel = () => cachedGet<PublicWheel>("/public/wheel", undefined, PUBLIC);
/** The server picks where the wheel lands; the page only animates to it. */
export const spinWheel = async () => (await http.post<WheelSpinResult>("/public/wheel/spin")).data;

export const adminWheel = () => cachedGet<AdminWheel>("/admin/wheel", undefined, SWR);
export const adminUpdateWheelConfig = async (patch: Partial<WheelConfig>) => {
  const c = (await http.put<WheelConfig>("/admin/wheel/config", patch)).data;
  wheelChanged();
  return c;
};
/** Multipart: label, amount, color and an optional `image`. */
export const adminCreateWheelSegment = async (form: FormData) => {
  const s = (await http.post<AdminWheelSegment>("/admin/wheel/segments", form)).data;
  wheelChanged();
  return s;
};
/** JSON patch, or multipart when replacing the image (`image` file) or removing it (removeImage=true). */
export const adminUpdateWheelSegment = async (
  id: string,
  patch: FormData | Partial<Pick<AdminWheelSegment, "label" | "amount" | "color" | "active">>
) => {
  const s = (await http.patch<AdminWheelSegment>(`/admin/wheel/segments/${id}`, patch)).data;
  wheelChanged();
  return s;
};
export const adminDeleteWheelSegment = async (id: string) => {
  const res = (await http.delete<{ id: string }>(`/admin/wheel/segments/${id}`)).data;
  wheelChanged();
  return res;
};
/** Returns only the segments whose order changed, as [id, sortOrder] pairs. */
export const adminMoveWheelSegment = async (id: string, direction: "up" | "down") => {
  const res = (await http.post<{ changed: [string, number][] }>(`/admin/wheel/segments/${id}/move`, { direction })).data;
  wheelChanged();
  return res;
};

// ---- public (no login) ----
export const getPublicGames = () => cachedGet<PublicGame[]>("/public/games", undefined, PUBLIC);
export const getPublicBanner = () => cachedGet<PublicBanner | null>("/public/banner", undefined, PUBLIC);
export const getPublicTags = () => cachedGet<PublicTag[]>("/public/tags", undefined, PUBLIC);

/** Returns only the games whose order changed, as [id, sortOrder] pairs. */
export const adminMoveGame = async (id: string, direction: "up" | "down") => {
  const res = (await http.post<{ changed: [string, number][] }>(`/admin/games/${id}/move`, { direction })).data;
  gamesChanged();
  return res;
};

export const adminAudit = (page: number) => cachedGet<Paged<AuditRow>>("/admin/audit", { page }, SWR);

// ---- cached copies, for a first render without a loading state (same URLs as the loaders above) ----
export const peekAdminUsers = (search: string, page: number) => peekCached<Paged<UserRow>>("/admin/users", clean({ search, page }));
export const peekAdminGames = () => peekCached<AdminGame[]>("/admin/games");
export const peekAdminTags = () => peekCached<AdminTag[]>("/admin/tags");
export const peekAdminWheel = () => peekCached<AdminWheel>("/admin/wheel");
export const peekAdminBanner = () => peekCached<AdminBanner>("/admin/banner");
export const peekAdminAudit = (page: number) => peekCached<Paged<AuditRow>>("/admin/audit", { page });
export const peekAdminEdits = (f: { userId?: string; paymentId?: string }, page: number) =>
  peekCached<Paged<EditRow>>("/admin/edits", clean({ ...f, page }));
export const peekAdminPayment = (id: string) => peekCached<PaymentDetail>(`/admin/payments/${id}`);
export const peekActiveGames = () => peekCached<GameOption[]>("/games");
export const peekPublicGames = () => peekCached<PublicGame[]>("/public/games");
export const peekPublicBanner = () => peekCached<PublicBanner | null>("/public/banner");
export const peekPublicTags = () => peekCached<PublicTag[]>("/public/tags");
export const peekPublicWheel = () => peekCached<PublicWheel>("/public/wheel");

export type ExportFormat = "csv" | "pdf";

/**
 * Columns the admin can pick for exports (keys match the backend). csvOnly ones are left out of the PDF;
 * pdfOnly ones of the CSV ("links" = Photo / Cashout buttons in the PDF, with the full URLs on its last page).
 */
export const EXPORT_COLUMNS: { key: string; label: string; csvOnly?: boolean; pdfOnly?: boolean }[] = [
  { key: "id", label: "Payment ID", csvOnly: true },
  { key: "date", label: "Date" },
  { key: "user", label: "User" },
  { key: "player", label: "Player" },
  { key: "game", label: "Game" },
  { key: "gameUsername", label: "Backend Username" },
  // The PDF is split into one section per method instead
  { key: "paymentMethod", label: "Payment Method", csvOnly: true },
  { key: "paymentTag", label: "Payment Tag" },
  { key: "deposit", label: "Deposit" },
  { key: "loaded", label: "Loaded" },
  { key: "redeemed", label: "Redeemed" },
  { key: "cashout", label: "Cashout" },
  { key: "cashoutMethod", label: "Cashout Method" },
  { key: "notes", label: "Notes", csvOnly: true },
  { key: "createdAt", label: "Created At", csvOnly: true },
  { key: "editedAt", label: "Edited At", csvOnly: true },
  { key: "screenshotUrl", label: "Screenshot URL", csvOnly: true },
  { key: "cashoutProofUrl", label: "Cashout Proof URL", csvOnly: true },
  { key: "links", label: "Images", pdfOnly: true },
];

export const defaultExportName = () => `payments-${new Date().toISOString().slice(0, 10)}`;

// Same rules as the backend: no path or reserved characters, no extension, at most 80 chars
const safeExportName = (name?: string) =>
  (name || "")
    .replace(/\.(csv|pdf)$/i, "")
    .replace(/[^\w.\- ]/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 80) || defaultExportName();

/** Download the filtered export through the authenticated client so the token is never put in a URL. */
export const downloadPaymentsExport = async (f: PaymentFilters, format: ExportFormat, columns?: string[], filename?: string) => {
  const name = safeExportName(filename);
  const params = clean({ ...f, columns: columns?.join(","), filename: name });
  const res = await http.get(`/admin/payments/export.${format}`, { params, responseType: "blob" });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
