import axios, { AxiosError } from "axios";

export const API_BASE_URL = "https://finance-tracker-backend-yuhn.onrender.com/api";

const http = axios.create({ baseURL: API_BASE_URL, timeout: 60000 });

// Login/register answer 401 for wrong credentials: that is not an expired session
const isAuthCall = (url: string) =>
  url.includes("/auth/login") || url.includes("/auth/register") || url.includes("/auth/admin/login") || url.includes("/auth/admin/set-role") || url.includes("/auth/me");

http.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Expired/invalid session: clear the token and send the user to the matching login page. */
export const handleExpiredSession = () => {
  if (!localStorage.getItem("token")) return;
  localStorage.removeItem("token");
  const loginPath = window.location.pathname.startsWith("/admin") ? "/admin/login" : "/login";
  if (window.location.pathname !== loginPath) window.location.assign(`${loginPath}?expired=1`);
};

http.interceptors.response.use(
  (res) => res,
  (error: AxiosError) => {
    if (error.response?.status === 401 && !isAuthCall(error.config?.url || "")) handleExpiredSession();
    return Promise.reject(error);
  }
);

const CODE_MESSAGES: Record<string, string> = {
  FILE_TOO_LARGE: "Screenshot is too large (max 5MB).",
  UNSUPPORTED_TYPE: "Unsupported image type. Use AVIF, JPG, PNG or WebP.",
  UPLOAD_FAILED: "Screenshot upload failed. Please try again.",
  GAME_UNAVAILABLE: "That game is no longer available. Pick another one.",
  SCREENSHOT_REQUIRED: "Please attach a screenshot.",
  RATE_LIMITED: "Too many requests. Please wait a bit and try again.",
  FORBIDDEN: "You are not authorized to do that.",
  INVALID_AUTH_CODE: "Wrong admin auth code.",
};

/** Turn any API error into a user-friendly message (never a raw stack trace). */
export const errorMessage = (error: unknown, fallback = "Something went wrong"): string => {
  const e = error as AxiosError<{ message?: string; code?: string }>;
  if (!e?.isAxiosError) return fallback;
  if (!e.response) return e.code === "ECONNABORTED" ? "Request timed out. Please try again." : "Network error. Check your connection.";
  const { status } = e.response;
  const data = e.response.data || {};
  // A 404 without our JSON error body means the route itself is missing: the API is an older deployment
  if (status === 404 && (typeof data !== "object" || (!data.code && !data.message))) {
    return "The server is out of date. Please try again shortly.";
  }
  if (status === 401) {
    return isAuthCall(e.config?.url || "") ? data.message || "Invalid username or password" : "Your session has expired. Please sign in again.";
  }
  if (data.code && CODE_MESSAGES[data.code]) return CODE_MESSAGES[data.code];
  if (status >= 500) return fallback;
  return data.message || fallback;
};

export const errorCode = (error: unknown): string | undefined =>
  (error as AxiosError<{ code?: string }>)?.response?.data?.code;

export default http;
