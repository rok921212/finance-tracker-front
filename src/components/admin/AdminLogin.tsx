import React, { FormEvent, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Button, Banner } from "../ui/ui";

const fieldClass =
  "w-full bg-black/50 border-2 border-red-500/50 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-red-500 focus:bg-black/70 transition-all duration-300 placeholder-gray-400";

const AdminLogin: React.FC = () => {
  const { adminLogin, setAdminRole, isAdmin, isLoading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [grantAdmin, setGrantAdmin] = useState(false);
  const [adminAuth, setAdminAuth] = useState("");
  const [message, setMessage] = useState(params.get("expired") ? "Your session has expired. Please sign in again." : "");
  const [submitting, setSubmitting] = useState(false);

  if (!isLoading && isAdmin) return <Navigate to="/admin" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage("");
    if (!username.trim() || !password) {
      setMessage("Username and password are required");
      return;
    }
    if (grantAdmin && !adminAuth) {
      setMessage("Admin auth code is required");
      return;
    }
    setSubmitting(true);
    const res = grantAdmin
      ? await setAdminRole(username.trim(), password, adminAuth, true)
      : await adminLogin(username.trim(), password);
    setSubmitting(false);
    if (res.success) navigate("/admin", { replace: true });
    else setMessage(res.message);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black flex items-center justify-center px-4">
      <div className="w-full max-w-md anim-in">
        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-red-500/20 shadow-2xl">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-r from-red-600 to-red-700 rounded-full mx-auto mb-4 flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h2 className="text-3xl font-bold text-white mb-2">Admin Console</h2>
            <p className="text-gray-400">Sign in with your administrator account</p>
          </div>
          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <label className="block text-red-400 font-medium mb-2">USERNAME</label>
              <input className={fieldClass} value={username} onChange={(e) => setUsername(e.target.value)} disabled={submitting} autoComplete="username" />
            </div>
            <div>
              <label className="block text-red-400 font-medium mb-2">PASSWORD</label>
              <input
                type="password"
                className={fieldClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                autoComplete="current-password"
              />
            </div>
            <label className="flex items-start gap-3 text-sm text-gray-300 cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-red-600"
                checked={grantAdmin}
                onChange={(e) => setGrantAdmin(e.target.checked)}
                disabled={submitting}
              />
              <span>Grant admin access to this account (requires admin auth code)</span>
            </label>
            {grantAdmin && (
              <div>
                <label className="block text-red-400 font-medium mb-2">ADMIN AUTH CODE</label>
                <input
                  type="password"
                  className={fieldClass}
                  value={adminAuth}
                  onChange={(e) => setAdminAuth(e.target.value)}
                  disabled={submitting}
                  autoComplete="off"
                />
              </div>
            )}
            {message && <Banner>{message}</Banner>}
            <Button type="submit" loading={submitting} className="w-full py-3 text-lg">
              {submitting ? "Please wait..." : grantAdmin ? "Grant Access & Sign In" : "Sign In"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
