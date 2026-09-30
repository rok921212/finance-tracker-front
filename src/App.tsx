import React, { Component, ReactNode, Suspense, lazy } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import "./App.css";

import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute/ProtectedRoute.tsx";
import AdminRoute from "./components/ProtectedRoute/AdminRoute.tsx";
import { PageFallback } from "./components/ui/ui";

// Each page is its own chunk: the first load only downloads the page being opened
const Home = lazy(() => import("./components/home/home"));
const Login = lazy(() => import("./components/Login/Login"));
const MainPage = lazy(() => import("./components/mainpage/mainpage"));
const PaymentsDashboard = lazy(() => import("./components/payments/PaymentsDashboard"));
const AddPaymentForm = lazy(() => import("./components/payments/AddPaymentForm"));
const AdminLogin = lazy(() => import("./components/admin/AdminLogin"));
const AdminDashboard = lazy(() => import("./components/admin/AdminDashboard"));

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
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/main" element={<MainPage />} />
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
