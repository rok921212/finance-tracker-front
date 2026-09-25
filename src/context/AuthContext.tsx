import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { AxiosError } from "axios";
import http, { errorMessage } from "../lib/http";
import { clearCache, useCachedGet } from "../lib/cache";
import { startLiveEvents, stopLiveEvents } from "../lib/liveEvents";

export interface User {
  id: string;
  username: string;
  role: "user" | "admin";
}

type AuthResult = { success: boolean; message: string };

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<AuthResult>;
  adminLogin: (username: string, password: string) => Promise<AuthResult>;
  register: (username: string, password: string, adminAuthCode: string) => Promise<AuthResult>;
  setAdminRole: (username: string, password: string, adminAuth: string, setAdmin: boolean) => Promise<AuthResult>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem("token"));

  // The signed-in account. Served from this tab's cache on reload (no request) and refetched only
  // when the server pushes a change to it, e.g. a role change.
  const me = useCachedGet<{ user: User }>(token ? "/auth/me" : null);
  useEffect(() => {
    if (me.data) setUser(me.data.user);
  }, [me.data]);
  useEffect(() => {
    // Invalid/expired token or deleted account (not a network hiccup): sign out
    const status = (me.error as AxiosError | undefined)?.response?.status;
    if (status === 401 || status === 404) {
      clearCache();
      localStorage.removeItem("token");
      setToken(null);
      setUser(null);
    }
  }, [me.error]);
  const isLoading = !!token && !user && !me.error;

  // Pushed data-version bumps keep every cached response current while signed in
  useEffect(() => {
    if (token) startLiveEvents();
    else stopLiveEvents();
  }, [token]);

  const authenticate = async (path: string, body: object, fallback: string): Promise<AuthResult> => {
    try {
      const response = await http.post(path, body);
      const { token, user } = response.data;
      stopLiveEvents(); // the next stream must carry the new account's token
      clearCache();
      localStorage.setItem("token", token);
      setToken(token);
      setUser(user);
      return { success: true, message: response.data.message };
    } catch (error: unknown) {
      return { success: false, message: errorMessage(error, fallback) };
    }
  };

  const login = (username: string, password: string) =>
    authenticate("/auth/login", { username, password }, "Login failed");

  const adminLogin = (username: string, password: string) =>
    authenticate("/auth/admin/login", { username, password }, "Login failed");

  const register = (username: string, password: string, adminAuthCode: string) =>
    authenticate("/auth/register", { username, password, adminAuthCode }, "Registration failed");

  const setAdminRole = (username: string, password: string, adminAuth: string, setAdmin: boolean) =>
    authenticate("/auth/admin/set-role", { username, password, adminAuth, setAdmin }, "Could not grant admin access");

  const logout = (): void => {
    stopLiveEvents();
    clearCache(); // never show one account's cached data to the next
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
  };

  const value: AuthContextType = {
    user,
    token,
    isAuthenticated: !!token && !!user,
    isAdmin: !!token && user?.role === "admin",
    isLoading,
    login,
    adminLogin,
    register,
    setAdminRole,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export default AuthContext;
