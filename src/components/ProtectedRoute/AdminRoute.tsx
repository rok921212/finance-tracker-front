import React, { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { PageFallback } from "../ui/ui";

// UX guard only: every /api/admin endpoint re-checks the admin role on the backend
const AdminRoute: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { isAdmin, isLoading } = useAuth();

  if (isLoading) return <PageFallback />;

  if (!isAdmin) {
    return <Navigate to="/admin/login" replace />;
  }

  return <>{children}</>;
};

export default AdminRoute;
