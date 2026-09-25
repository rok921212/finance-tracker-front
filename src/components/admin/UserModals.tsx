import React, { FormEvent, useEffect, useState } from "react";
import { Banner, Button, Modal, inputClass } from "../ui/ui";
import { adminDeleteUser, adminUpdateUser, Role } from "../../lib/paymentsApi";
import { errorMessage } from "../../lib/http";

export interface ManagedUser {
  id: string;
  username: string;
  role?: Role;
  count?: number;
}

const Label: React.FC<{ text: string; children: React.ReactNode }> = ({ text, children }) => (
  <label className="block">
    <span className="block text-sm text-gray-400 mb-1">{text}</span>
    {children}
  </label>
);

// Changing an admin account also needs the admin auth code
const AuthCodeInput: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => (
  <Label text="Admin auth code (required for admin accounts)">
    <input type="password" className={inputClass} value={value} autoComplete="off" onChange={(e) => onChange(e.target.value)} />
  </Label>
);

/** Rename and/or reset the password. Blank password fields keep the current password. */
export const EditUserModal: React.FC<{
  user: ManagedUser | null;
  isMe: boolean;
  onClose: () => void;
  onSaved: (u: { id: string; username: string; role: Role }) => void;
}> = ({ user, isMe, onClose, onSaved }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setUsername(user?.username || "");
    setPassword("");
    setConfirm("");
    setAuthCode("");
    setError("");
  }, [user]);

  if (!user) return null;
  const isAdmin = user.role === "admin";
  const nameChanged = username.trim() !== user.username;
  const canSave = (nameChanged || !!password) && (!isAdmin || !!authCode) && !busy;

  const close = () => !busy && onClose();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    const name = username.trim();
    if (nameChanged && (name.length < 3 || name.length > 30)) return setError("Username must be 3-30 characters");
    if (password && password.length < 6) return setError("Password must be at least 6 characters");
    if (password !== confirm) return setError("Passwords do not match");
    setBusy(true);
    setError("");
    try {
      const res = await adminUpdateUser(user.id, {
        ...(nameChanged ? { username: name } : {}),
        ...(password ? { password } : {}),
        ...(isAdmin ? { adminAuth: authCode } : {}),
      });
      onSaved(res);
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Could not update user"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!user} onClose={close} title={`Edit ${user.username}`}>
      <form onSubmit={submit} className="space-y-4">
        <Label text="Username">
          <input className={inputClass} value={username} maxLength={30} autoFocus onChange={(e) => setUsername(e.target.value)} />
        </Label>
        <Label text="New password (leave blank to keep the current one)">
          <input type="password" className={inputClass} value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
        </Label>
        {password && (
          <>
            <Label text="Confirm new password">
              <input type="password" className={inputClass} value={confirm} autoComplete="new-password" onChange={(e) => setConfirm(e.target.value)} />
            </Label>
            <p className="text-xs text-amber-300">
              {isMe
                ? "Changing your own password signs you out; log in again with the new password."
                : "This signs the user out of all devices."}
            </p>
          </>
        )}
        {isAdmin && <AuthCodeInput value={authCode} onChange={setAuthCode} />}
        {error && <Banner>{error}</Banner>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!canSave}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
};

/** Permanent delete of the account and all its entries; the username must be typed to confirm. */
export const DeleteUserModal: React.FC<{
  user: ManagedUser | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}> = ({ user, onClose, onDeleted }) => {
  const [typed, setTyped] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setTyped("");
    setAuthCode("");
    setError("");
  }, [user]);

  if (!user) return null;
  const isAdmin = user.role === "admin";
  const canDelete = typed === user.username && (!isAdmin || !!authCode) && !busy;
  const close = () => !busy && onClose();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canDelete) return;
    setBusy(true);
    setError("");
    try {
      await adminDeleteUser(user.id, isAdmin ? authCode : undefined);
      onDeleted(user.id);
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Could not delete user"));
    } finally {
      setBusy(false);
    }
  };

  const entries = user.count ?? 0;
  return (
    <Modal open={!!user} onClose={close} title="Delete user">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-gray-300 text-sm">
          Delete <span className="text-white font-semibold">{user.username}</span>
          {isAdmin ? " (admin)" : ""} and{" "}
          <span className="text-white font-semibold">
            {entries === 1 ? "their 1 entry" : `all ${entries.toLocaleString()} of their entries`}
          </span>
          ? Their loaded points go back to each game. <span className="text-red-300">This cannot be undone.</span>
        </p>
        <Label text={`Type "${user.username}" to confirm`}>
          <input className={inputClass} value={typed} autoFocus autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
        </Label>
        {isAdmin && <AuthCodeInput value={authCode} onChange={setAuthCode} />}
        {error && <Banner>{error}</Banner>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={busy} disabled={!canDelete}>
            Delete user
          </Button>
        </div>
      </form>
    </Modal>
  );
};
