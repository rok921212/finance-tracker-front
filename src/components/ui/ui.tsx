import React, { ReactNode, useEffect } from "react";

// Shared building blocks that follow the existing app's dark glass + red accent design

export const Page: React.FC<{ children: ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black text-white">{children}</div>
);

export const Card: React.FC<{ children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }> = ({
  children,
  className = "",
  title,
  actions,
}) => (
  <div className={`bg-white/5 backdrop-blur-md rounded-xl border border-gray-700/50 ${className}`}>
    {(title || actions) && (
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 md:px-6 pt-4 md:pt-5">
        {title && (
          <h2 className="text-lg font-bold text-white flex items-center">
            <span className="w-2 h-6 bg-red-500 mr-3 rounded-full"></span>
            {title}
          </h2>
        )}
        {actions}
      </div>
    )}
    <div className="p-4 md:p-6">{children}</div>
  </div>
);

const STAT_TONES = {
  green: "from-green-600/20 to-green-700/20 border-green-500/30 text-green-400",
  blue: "from-blue-600/20 to-blue-700/20 border-blue-500/30 text-blue-400",
  purple: "from-purple-600/20 to-purple-700/20 border-purple-500/30 text-purple-400",
  red: "from-red-600/20 to-red-700/20 border-red-500/30 text-red-400",
  yellow: "from-yellow-600/20 to-yellow-700/20 border-yellow-500/30 text-yellow-400",
  gray: "from-gray-600/20 to-gray-700/20 border-gray-500/30 text-gray-300",
};

export const StatCard: React.FC<{
  label: string;
  value: ReactNode;
  tone?: keyof typeof STAT_TONES;
  /** Optional breakdown shown under the value */
  children?: ReactNode;
}> = ({ label, value, tone = "gray", children }) => (
  <div className={`bg-gradient-to-br backdrop-blur-md rounded-xl p-4 md:p-5 border ${STAT_TONES[tone]}`}>
    <p className="text-xs md:text-sm uppercase tracking-wider opacity-90">{label}</p>
    <p className="text-xl md:text-2xl font-bold text-white mt-1 tabular-nums break-all">{value}</p>
    {children}
  </div>
);

type ButtonVariant = "primary" | "ghost" | "danger" | "success";
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-r from-red-600 to-red-700 text-white hover:from-red-700 hover:to-red-800 border border-red-500 shadow-lg hover:shadow-red-500/25",
  ghost: "bg-gray-700/50 border border-gray-600 text-gray-200 hover:bg-gray-700 hover:text-white",
  danger: "bg-red-600/20 border border-red-500/60 text-red-300 hover:bg-red-600/40 hover:text-white",
  success: "bg-green-600/80 border border-green-500 text-white hover:bg-green-600",
};

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }
> = ({ variant = "primary", loading, disabled, className = "", children, ...rest }) => (
  <button
    {...rest}
    disabled={disabled || loading}
    className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${className}`}
  >
    {loading && <Spinner />}
    {children}
  </button>
);

export const Spinner: React.FC<{ className?: string }> = ({ className = "h-4 w-4" }) => (
  <svg className={`animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
  </svg>
);

export const inputClass =
  "w-full bg-black/50 border border-gray-600 text-white px-3 py-2 rounded-lg focus:outline-none focus:border-red-500 placeholder-gray-500 disabled:opacity-60";

export const Field: React.FC<{ label: string; error?: string; children: ReactNode; htmlFor?: string }> = ({
  label,
  error,
  children,
  htmlFor,
}) => (
  <div>
    <label htmlFor={htmlFor} className="block text-red-400 text-sm font-medium mb-1 uppercase tracking-wide">
      {label}
    </label>
    {children}
    {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
  </div>
);

export const Banner: React.FC<{ tone?: "error" | "ok" | "info"; children: ReactNode }> = ({ tone = "error", children }) => {
  const cls =
    tone === "ok"
      ? "bg-green-600/20 border-green-500/50 text-green-200"
      : tone === "info"
      ? "bg-blue-600/20 border-blue-500/50 text-blue-200"
      : "bg-red-600/20 border-red-500/50 text-red-200";
  return <div className={`p-3 rounded-lg border text-sm ${cls}`}>{children}</div>;
};

export const Pagination: React.FC<{ page: number; pages: number; total: number; onChange: (p: number) => void }> = ({
  page,
  pages,
  total,
  onChange,
}) => (
  <div className="flex items-center justify-between gap-3 pt-4 text-sm text-gray-400">
    <span>{total.toLocaleString()} total</span>
    <div className="flex items-center gap-2">
      <Button variant="ghost" className="px-3 py-1" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Prev
      </Button>
      <span className="tabular-nums">
        {page} / {pages}
      </span>
      <Button variant="ghost" className="px-3 py-1" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Next
      </Button>
    </div>
  </div>
);

export const Modal: React.FC<{ open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }> = ({
  open,
  onClose,
  title,
  children,
  wide,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="anim-fade fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start md:items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`bg-gray-900 rounded-2xl border border-gray-700 w-full ${wide ? "max-w-4xl" : "max-w-md"} my-8 anim-pop`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/70">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-white text-2xl leading-none">
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
};

export const Th: React.FC<{ children?: ReactNode; right?: boolean }> = ({ children, right }) => (
  <th className={`px-3 py-3 font-medium ${right ? "text-right" : "text-left"}`}>{children}</th>
);
export const Td: React.FC<{ children?: ReactNode; right?: boolean; className?: string }> = ({ children, right, className = "" }) => (
  <td className={`px-3 py-3 ${right ? "text-right tabular-nums" : ""} ${className}`}>{children}</td>
);

export const Table: React.FC<{ head: ReactNode; children: ReactNode; empty?: boolean; loading?: boolean }> = ({
  head,
  children,
  empty,
  loading,
}) => (
  <div className="overflow-x-auto -mx-4 md:mx-0">
    <table className="w-full min-w-[640px] text-sm">
      <thead>
        <tr className="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wider">{head}</tr>
      </thead>
      <tbody className="divide-y divide-gray-700/50 text-gray-200">{children}</tbody>
    </table>
    {loading && (
      <div className="flex justify-center py-8 text-gray-400">
        <Spinner className="h-6 w-6" />
      </div>
    )}
    {!loading && empty && <p className="text-center text-gray-500 py-8">No records found</p>}
  </div>
);
