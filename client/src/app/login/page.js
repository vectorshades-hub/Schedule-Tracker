"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/AuthContext";
import { api, ApiError } from "../../lib/api";
import SearchableDropdown from "../../components/SearchableDropdown";

const AVATAR_COLORS = ["#4da6ff", "#e67e22", "#27ae60", "#7c3aed", "#e74c3c", "#0dcaf0", "#d4145a"];
function avatarColor(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function LoginPage() {
  const [usernames, setUsernames] = useState([]);
  const [pickedName, setPickedName] = useState("");
  const [displayValue, setDisplayValue] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState(false);
  const [busy, setBusy] = useState(false);
  const pwRef = useRef(null);
  const { login, user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    api.get("/auth/usernames").then((d) => setUsernames(d.usernames || []));
  }, []);

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!pickedName || pickedName !== displayValue) {
      setNameError(true);
      return;
    }
    setNameError(false);
    setError("");
    setBusy(true);
    try {
      await login(pickedName, password);
      router.push("/");
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo-row">
          <img src="/logo.png" alt="" width={22} height={22} onError={(e) => (e.currentTarget.style.display = "none")} />
          <h1 className="login-title">Schedule Tracker</h1>
        </div>
        <p className="login-subtitle">Sign in to continue</p>

        {error && (
          <div className="alert alert-danger py-2 text-start" style={{ fontSize: "0.88rem" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="login-field">
            <label>Your Name</label>
            <SearchableDropdown
              value={displayValue}
              onChange={(v) => {
                setDisplayValue(v);
                setPickedName("");
              }}
              onSelect={(v) => {
                setPickedName(v);
                setDisplayValue(v);
                setTimeout(() => pwRef.current?.focus(), 0);
              }}
              options={usernames}
              placeholder="Search your name..."
              openOnFocus={false}
              renderOption={(name) => (
                <div className="d-flex align-items-center gap-2">
                  <span
                    className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold"
                    style={{ width: 24, height: 24, fontSize: 12, background: avatarColor(name) }}
                  >
                    {name.charAt(0).toUpperCase()}
                  </span>
                  {name}
                </div>
              )}
            />
            {nameError && <div className="text-danger small mt-1">Please pick your name from the list.</div>}
          </div>

          <div className="login-field">
            <label>Password</label>
            <input
              ref={pwRef}
              type="password"
              placeholder="Enter Password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button type="submit" className="login-button" disabled={busy}>
            {busy ? "Signing in…" : "Sign In →"}
          </button>
        </form>

        <p className="login-footer">Developed by R &amp; D Department, Vectorshades LLC</p>
      </div>
    </div>
  );
}
