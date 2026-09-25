import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
    isActive ? "bg-red-600/20 text-white border border-red-500/50" : "text-gray-300 hover:text-white hover:bg-white/5"
  }`;

/** Header for the user-facing payment pages, styled like the existing dashboard header. */
const AppHeader: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="bg-gradient-to-r from-gray-900 to-black border-b border-gray-800 px-4 md:px-8 py-4">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-red-700 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-bold text-white">Finance Tracker Pro</h1>
            <p className="text-gray-400 text-xs md:text-sm">Welcome, {user?.username || "User"}</p>
          </div>
        </div>
        <nav className="flex items-center gap-1 md:gap-2">
          <NavLink to="/payments" end className={linkClass}>
            Payments
          </NavLink>
          <NavLink to="/payments/new" className={linkClass}>
            Add Entry
          </NavLink>
          <button
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="px-3 py-2 rounded-lg text-sm bg-gray-700/50 border border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white"
          >
            Logout
          </button>
        </nav>
      </div>
    </div>
  );
};

export default AppHeader;
