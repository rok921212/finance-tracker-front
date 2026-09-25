import React, { Suspense, lazy } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import "./App.css";

import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute/ProtectedRoute.tsx";
import AdminRoute from "./components/ProtectedRoute/AdminRoute.tsx";
import { Spinner } from "./components/ui/ui";

// Each page is its own chunk: the first load only downloads the page being opened
const Home = lazy(() => import("./components/home/home"));
const Login = lazy(() => import("./components/Login/Login"));
const MainPage = lazy(() => import("./components/mainpage/mainpage"));
const PaymentsDashboard = lazy(() => import("./components/payments/PaymentsDashboard"));
const AddPaymentForm = lazy(() => import("./components/payments/AddPaymentForm"));
const AdminLogin = lazy(() => import("./components/admin/AdminLogin"));
const AdminDashboard = lazy(() => import("./components/admin/AdminDashboard"));

const PageFallback = () => (
  <div className="min-h-screen bg-black flex items-center justify-center text-gray-300">
    <Spinner className="h-8 w-8" />
  </div>
);

function AppContent() {
  return (
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