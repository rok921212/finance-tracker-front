// Shared client adds the base URL and auth header
import http from "./lib/http";
import { cachedGet, trackedWrite, updateCached } from "./lib/cache";

// Type definitions
export interface Booking {
  _id?: string;
  customerName?: string;
  date: string;
  time: string;
  server: string;
  entryFee: number;
  winning: number;
  discription: string;
  caster: string;
  casterCost: number;
  production: string;
  productionCost: number;
  paid?: boolean; // Entry fee paid status - default false (unpaid)
}

export interface Team {
  _id: string;
  teamName: string;
  bookings: Booking[];
}

export interface CreateTeamRequest {
  teamName: string;
  bookings: Booking[];
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

// API functions
// Served from the cache until the server pushes a change to this user's bookings
export const fetchTeams = (): Promise<Team[]> => cachedGet<Team[]>("/bookingData");

/** Keep the cached team list in step with local delta updates. */
export const updateCachedTeams = (fn: (teams: Team[]) => Team[]) => updateCached<Team[]>("/bookingData", undefined, fn);

// Own booking writes: the page patches the cached team list itself, so the server's push for this
// very write must not trigger a refetch (a change from another device still does)
const TEAMS = { url: "/bookingData" };
const write = <R extends { headers: Record<string, unknown> }>(send: () => Promise<R>) => trackedWrite("bookings", TEAMS, send);

export const createTeam = async (teamData: CreateTeamRequest): Promise<Team> => {
  const response = await write(() => http.post<Team>(`/bookingData`, teamData));
  return response.data;
};

export const deleteTeam = async (teamName: string): Promise<void> => {
  const encodedName = encodeURIComponent(teamName);
  await write(() => http.delete(`/bookingData/${encodedName}`));
};

/** Server responds with only the stored booking (not the whole team). */
export const addBooking = async (teamName: string, booking: Booking): Promise<Booking> => {
  const encodedName = encodeURIComponent(teamName);
  const res = await write(() => http.post<{ booking: Booking }>(`/bookingData/${encodedName}/bookings`, booking));
  return res.data.booking;
};

/** Send only changed fields; server responds with just those fields as stored. */
export const updateBooking = async (
  teamName: string,
  bookingIndex: number,
  changes: Partial<Booking>
): Promise<Partial<Booking>> => {
  const encodedName = encodeURIComponent(teamName);
  const res = await write(() =>
    http.put<{ index: number; changes: Partial<Booking> }>(`/bookingData/${encodedName}/bookings/${bookingIndex}`, changes)
  );
  return res.data.changes;
};

export const deleteBooking = async (
  teamName: string,
  bookingIndex: number
): Promise<void> => {
  const encodedName = encodeURIComponent(teamName);
  await write(() => http.delete(`/bookingData/${encodedName}/bookings/${bookingIndex}`));
};

// Export default object with all API methods
const api = {
  fetchTeams,
  createTeam,
  deleteTeam,
  addBooking,
  updateBooking,
  deleteBooking,
};

export default api;