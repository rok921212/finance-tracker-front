import React, { Component, ReactNode, Suspense, lazy, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import "./App.css";

import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute/ProtectedRoute.tsx";
import AdminRoute from "./components/ProtectedRoute/AdminRoute.tsx";
import { PageFallback } from "./components/ui/ui";
import { whenIdle } from "./lib/cache";

// Each page is its own chunk: the first load only downloads the page being opened
const pages = {
  home: () => import("./components/home/home"),
  login: () => import("./components/Login/Login"),
  main: () => import("./components/mainpage/mainpage"),
  payments: () => import("./components/payments/PaymentsDashboard"),
  addPayment: () => import("./components/payments/AddPaymentForm"),
  adminLogin: () => import("./components/admin/AdminLogin"),
  admin: () => import("./components/admin/AdminDashboard"),
  publicGames: () => import("./components/public/PublicGames"),
  publicTags: () => import("./components/public/PublicTags"),
  publicWheel: () => import("./components/public/PublicWheel"),
};
const Home = lazy(pages.home);
const Login = lazy(pages.login);
const MainPage = lazy(pages.main);
const PaymentsDashboard = lazy(pages.payments);
const AddPaymentForm = lazy(pages.addPayment);
const AdminLogin = lazy(pages.adminLogin);
const AdminDashboard = lazy(pages.admin);
const PublicGames = lazy(pages.publicGames);
const PublicTags = lazy(pages.publicTags);
const PublicWheel = lazy(pages.publicWheel);

type PageName = keyof typeof pages;
const PUBLIC_PAGES: PageName[] = ["publicGames", "publicTags", "publicWheel"];
const USER_PAGES: PageName[] = ["payments", "addPayment", "home", "main"];

/**
 * Once the first page is on screen, download the code of the pages this visitor can open next, so
 * navigating never waits on a chunk. (Webpack loads each chunk once; a later lazy() just reuses it.)
 */
function usePrefetchPages() {
  const { isAuthenticated, isAdmin } = useAuth();
  useEffect(() => {
    const names: PageName[] = isAdmin
      ? ["admin", ...USER_PAGES]
      : isAuthenticated
        ? USER_PAGES
        : [...PUBLIC_PAGES, "login", "adminLogin"];
    whenIdle(() => names.forEach((n) => pages[n]().catch(() => {})));
  }, [isAuthenticated, isAdmin]);
}

const RELOADED_KEY = "chunk-reloaded";
const isChunkError = (error: Error) =>
  /ChunkLoadError|Loading (CSS )?chunk|dynamically imported module/i.test(`${error?.name} ${error?.message}`);

// A page chunk that fails to load (usually an old tab after a new deploy) would otherwise leave a
// blank white page: reload once to pick up the new build, else show a way out
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    try {
      if (isChunkError(error) && !sessionStorage.getItem(RELOADED_KEY)) {
        sessionStorage.setItem(RELOADED_KEY, "1");
        window.location.reload();
      }
    } catch {
      // storage unavailable: show the fallback
    }
  }

  componentDidMount() {
    // Loaded fine: allow one reload again next time
    window.setTimeout(() => {
      try {
        if (!this.state.failed) sessionStorage.removeItem(RELOADED_KEY);
      } catch {
        // storage unavailable
      }
    }, 5000);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4 text-gray-300 px-4 text-center">
        <p>Something went wrong while loading this page.</p>
        <button
          className="px-4 py-2 rounded-lg font-semibold bg-red-600 text-white hover:bg-red-700"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}

function AppContent() {
  usePrefetchPages();
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/main" element={<MainPage />} />
          {/* No login: the link admins share from the Public Page tab */}
          <Route path="/play" element={<PublicGames />} />
          <Route path="/tags" element={<PublicTags />} />
          <Route path="/wheel" element={<PublicWheel />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />
          <Route
            path="/payments"
            element={
              <ProtectedRoute>
                <PaymentsDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/payments/new"
            element={
              <ProtectedRoute>
                <AddPaymentForm />
              </ProtectedRoute>
            }
          />
          <Route
            path="/payments/:id/edit"
            element={
              <ProtectedRoute>
                <AddPaymentForm />
              </ProtectedRoute>
            }
          />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <AdminDashboard />
              </AdminRoute>
            }
          />
          <Route path="*" element={<Navigate to="/payments" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppContent />
      </Router>
    </AuthProvider>
  );
}

export default App;
