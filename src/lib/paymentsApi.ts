import http from "./http";
import { cachedGet, invalidateCached, keyOf, parseVersions, peekCached, settleWrite, trackedWrite, updateCached, CacheOptions } from "./cache";
import { mergeChanges } from "./deltaSync";
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

// Everything a payment write can make stale, apart from the rows the write itself patches in
const PAYMENT_DATA = ["/payments", "/admin/"];
// The user's default list, first page: the one own writes patch in place
const myFirstPage = () => ({ url: "/payments", params: myPaymentsParams(1) });

/** Adds the new row to the cached list, so no table has to reload for it. */
export const createPayment = async (form: FormData) => {
  const list = myFirstPage();
  const res = await trackedWrite("payments", list, () => http.post<{ message: string; payment: PaymentDetail }>("/payments", form));
  const row = res.data.payment;
  updateCached<Paged<PaymentRow>>(list.url, list.params, (d) => {
    const { items } = mergeChanges<PaymentRow>(d, [{ ...row, createdAt: "", match: true }], { limit: MY_PAGE_SIZE });
    const total = d.total + 1; // counted even when the row sorts past this page
    return { ...d, items, total, pages: Math.max(1, Math.ceil(total / MY_PAGE_SIZE)) };
  });
  settleWrite(PAYMENT_DATA, parseVersions(res.headers["x-data-versions"]), keyOf(list.url, list.params));
  return res.data;
};

/** A backend username this user entered before, most recently used first (case variants merged). */
export interface UsernameSuggestion {
  name: string;
  count: number;
  lastUsed: string;
}
export const MY_GAME_USERNAMES_URL = "/payments/game-usernames";
/** The user's previous backend usernames, optionally only for one game (cached; refreshed after writes). */
export const getMyGameUsernames = (gameId?: string) =>
  cachedGet<UsernameSuggestion[]>(MY_GAME_USERNAMES_URL, clean({ gameId }), SWR);

export const MY_PAGE_SIZE = 18; // fills a 3- or 2-column card grid evenly
export type MySort = "date" | "deposit" | "loaded" | "redeemed" | "cashout" | "player" | "gameUsername" | "paymentMethod";

/** How the user's list is shown. Empty = newest first, all players. */
export interface MyListView {
  sort?: MySort;
  order?: "asc" | "desc";
  /** Start of the player name or payment tag (any case) */
  player?: string;
  /** Inclusive day range, YYYY-MM-DD */
  dateFrom?: string;
  dateTo?: string;
}

/** True when the list is in its default order with no filter (live updates can be merged in place). */
export const isDefaultView = (view: MyListView = {}) =>
  (!view.sort || view.sort === "date") && !view.order && !view.player && !view.dateFrom && !view.dateTo;

/** The view's filters as query params, shared by the list and the summary (undefined when none are set). */
export const myFilterParams = ({ player, dateFrom, dateTo }: MyListView = {}) => {
  const params = clean({ player, dateFrom, dateTo });
  return Object.keys(params).length ? params : undefined;
};

// Only non-default values are sent, so the default view keeps one cache key
export const myPaymentsParams = (page: number, view: MyListView = {}) => ({
  page,
  limit: MY_PAGE_SIZE,
  ...(view.sort && view.sort !== "date" ? { sort: view.sort } : {}),
  ...(view.order ? { order: view.order } : {}),
  ...myFilterParams(view),
});
// Changed rows can only be merged into the default order; any other view reloads when its data changes
export const getMyPayments = (page: number, view?: MyListView) =>
  cachedGet<Paged<PaymentRow>>("/payments", myPaymentsParams(page, view), isDefaultView(view) ? { deltaPrefix: "payments" } : {});

/** Totals of the entries matching the view's player and date filters. */
export const getMySummary = (view?: MyListView) => cachedGet<MySummary>("/payments/summary", myFilterParams(view), SWR);

/** Single entry including the full-size screenshot URL (list rows only carry a thumbnail). */
export const getMyPayment = (id: string) => cachedGet<PaymentDetail>(`/payments/${id}`, undefined, SWR);

/** Edit an own entry (the change is logged for the admin); omitting screenshot / cashoutProof keeps the current ones. */
export const updatePayment = async (id: string, form: FormData, onProgress?: (pct: number) => void) => {
  const list = myFirstPage();
  const res = await trackedWrite("payments", list, () =>
    http.patch<{ message: string; payment: PaymentDetail }>(`/payments/${id}`, form, {
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    })
  );
  const row = res.data.payment;
  const items = peekCached<Paged<PaymentRow>>(list.url, list.params)?.items || [];
  const shown = items.find((r) => r.id === id);
  // The first page keeps its order unless the entry changed day, or moved up into it from a later page
  const inPlace = shown ? shown.date === row.date : !!items.length && row.date < items[items.length - 1].date;
  if (shown && inPlace) {
    updateCached<Paged<PaymentRow>>(list.url, list.params, (d) => ({ ...d, items: d.items.map((r) => (r.id === id ? { ...r, ...row } : r)) }));
  }
  settleWrite(PAYMENT_DATA, parseVersions(res.headers["x-data-versions"]), inPlace ? keyOf(list.url, list.params) : undefined);
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
/** Direction of an admin list's date sort. Newest first is the default and is never sent, so it keeps one cache key. */
export type SortOrder = "asc" | "desc";
const orderParam = (order?: SortOrder) => (order === "asc" ? order : undefined);

export const adminPaymentsParams = (f: PaymentFilters, page: number, order?: SortOrder) =>
  clean({ ...f, page, limit: ADMIN_PAGE_SIZE, order: orderParam(order) });
export const adminPayments = (f: PaymentFilters, page: number, order?: SortOrder) =>
  // Delta sync merges rows newest first; oldest first is dropped on a change and refetched instead
  cachedGet<Paged<PaymentRow>>("/admin/payments", adminPaymentsParams(f, page, order), order === "asc" ? {} : { deltaPrefix: "payments" });

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
export const adminEditsParams = (f: { userId?: string; paymentId?: string }, page: number, order?: SortOrder) =>
  clean({ ...f, page, order: orderParam(order) });
export const adminEdits = (f: { userId?: string; paymentId?: string }, page: number, order?: SortOrder) =>
  cachedGet<Paged<EditRow>>("/admin/edits", adminEditsParams(f, page, order), SWR);

/** Permanent delete (admin only). */
export const adminDeletePayment = async (id: string) => {
  // Open tables drop the row themselves and sync the rest as a delta
  const res = await trackedWrite("payments", { url: "/admin/payments" }, () => http.delete<{ message: string; id: string }>(`/admin/payments/${id}`));
  settleWrite(PAYMENT_DATA, parseVersions(res.headers["x-data-versions"]));
  return res.data;
};

/** `joined` sorts by join date; left out, the list is A-Z by username. */
export const adminUsersParams = (search: string, page: number, joined?: SortOrder) =>
  clean({ search, page, ...(joined ? { sort: "createdAt", order: joined } : {}) });
export const adminUsers = (search: string, page: number, joined?: SortOrder) =>
  cachedGet<Paged<UserRow>>("/admin/users", adminUsersParams(search, page, joined), SWR);

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
/** Permanently deletes a game and its saved logins. Refused (409) while any entry uses the game. */
export const adminDeleteGame = async (id: string) => {
  await http.delete(`/admin/games/${id}`);
  gamesChanged();
};
export const adminRemoveGameImage = async (id: string) => {
  const g = (await http.delete<AdminGame>(`/admin/games/${id}/image`)).data;
  gamesChanged();
  return g;
};

// ---- backend logins per game (admin only; never cached: passwords only come from reveal) ----
export interface GameCredential {
  id: string;
  gameId: string;
  label: string;
  username: string;
  notes: string;
  /** Game backend admin panel link ("" = none) */
  adminUrl: string;
  /** Player-facing game link ("" = none) */
  gameUrl: string;
  createdAt: string;
  updatedAt: string;
}
export type GameCredentialInput = {
  label?: string;
  username?: string;
  password?: string;
  notes?: string;
  adminUrl?: string;
  gameUrl?: string;
};
const credentialsUrl = (gameId: string) => `/admin/games/${gameId}/credentials`;
/** Number of saved logins per game id */
export const adminCredentialCounts = async () => (await http.get<Record<string, number>>("/admin/games/credential-counts")).data;
export const adminGameCredentials = async (gameId: string) => (await http.get<GameCredential[]>(credentialsUrl(gameId))).data;
export const adminCreateGameCredential = async (gameId: string, body: GameCredentialInput) =>
  (await http.post<GameCredential>(credentialsUrl(gameId), body)).data;
/** An empty password keeps the current one */
export const adminUpdateGameCredential = async (gameId: string, id: string, body: GameCredentialInput) =>
  (await http.patch<GameCredential>(`${credentialsUrl(gameId)}/${id}`, body)).data;
export const adminDeleteGameCredential = async (gameId: string, id: string) => {
  await http.delete(`${credentialsUrl(gameId)}/${id}`);
};
/** The stored password in plain text (recorded in the audit log) */
export const adminRevealGameCredential = async (gameId: string, id: string) =>
  (await http.post<{ id: string; password: string }>(`${credentialsUrl(gameId)}/${id}/reveal`)).data.password;

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

export const adminAuditParams = (page: number, order?: SortOrder) => clean({ page, order: orderParam(order) });
export const adminAudit = (page: number, order?: SortOrder) => cachedGet<Paged<AuditRow>>("/admin/audit", adminAuditParams(page, order), SWR);

// ---- cached copies, for a first render without a loading state (same URLs as the loaders above) ----
export const peekAdminUsers = (search: string, page: number, joined?: SortOrder) =>
  peekCached<Paged<UserRow>>("/admin/users", adminUsersParams(search, page, joined));
export const peekAdminGames = () => peekCached<AdminGame[]>("/admin/games");
export const peekAdminTags = () => peekCached<AdminTag[]>("/admin/tags");
export const peekAdminWheel = () => peekCached<AdminWheel>("/admin/wheel");
export const peekAdminBanner = () => peekCached<AdminBanner>("/admin/banner");
export const peekAdminAudit = (page: number, order?: SortOrder) => peekCached<Paged<AuditRow>>("/admin/audit", adminAuditParams(page, order));
export const peekAdminEdits = (f: { userId?: string; paymentId?: string }, page: number, order?: SortOrder) =>
  peekCached<Paged<EditRow>>("/admin/edits", adminEditsParams(f, page, order));
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

/** Backend usernames reported as one name in exports (matching ignores case; stored data is unchanged). */
export interface UsernameMerge {
  name: string;
  members: string[];
}

/** A backend username left out of the PDF (matching ignores case); no methods means every method. */
export interface ExportExclusion {
  name: string;
  methods: PaymentMethod[];
}

export interface ExportOptions {
  columns?: string[];
  filename?: string;
  merge?: UsernameMerge[];
  /** Group rows by payment method, then backend username, with a subtotal per username */
  groupByUsername?: boolean;
  /** PDF only */
  exclude?: ExportExclusion[];
}

/** Download the filtered export through the authenticated client so the token is never put in a URL. */
export const downloadPaymentsExport = async (f: PaymentFilters, format: ExportFormat, opts: ExportOptions = {}) => {
  const { columns, filename, merge, groupByUsername, exclude } = opts;
  const name = safeExportName(filename);
  const params = clean({
    ...f,
    columns: columns?.join(","),
    filename: name,
    merge: merge && merge.length ? JSON.stringify(merge) : undefined,
    groupByUsername: groupByUsername ? "1" : undefined,
    exclude: exclude && exclude.length ? JSON.stringify(exclude) : undefined,
  });
  const res = await http.get(`/admin/payments/export.${format}`, { params, responseType: "blob" });
  saveFile(res.data as Blob, `${name}.${format}`);
};

/** The user's own entries as a PDF, under the view's player and date filters. */
export const downloadMyPdf = async (view: MyListView = {}) => {
  const filename = defaultExportName();
  const res = await http.get("/payments/export.pdf", { params: { ...myFilterParams(view), filename }, responseType: "blob" });
  saveFile(res.data as Blob, `${filename}.pdf`);
};

const saveFile = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
