import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./supabaseClient";
import uppLogo from "./assets/utah_pectus_logo.png";
import "./LoginPage.css";

const PRIMARY = "#d22d2d";

export default function LoginPage() {
  const nav = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);

    const normalizedEmail = email.trim().toLowerCase();
    const pw = password;

    const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password: pw });

    if (error) {
      setLoading(false);
      return setErr(error.message);
    }

    // Confirm session token is valid against auth server before routing.
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    setLoading(false);
    if (userErr || !userData?.user) {
      await supabase.auth.signOut();
      return setErr("Session validation failed. Please sign in again.");
    }

    nav("/dashboard");
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <img src={uppLogo} alt="Utah Pectus Program Logo" className="login-logo" />

        <h1 className="login-title">PROVIDER DASHBOARD</h1>
        <p className="login-subtitle">Sign in to the provider dashboard</p>

        <form className="login-form" onSubmit={onSubmit}>
          <input
            className="login-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />

          <div className="pw-wrap">
            <input
              className="login-input"
              type={showPw ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button
              type="button"
              className="pw-toggle"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Hide password" : "Show password"}
              title={showPw ? "Hide password" : "Show password"}
            >
              {showPw ? "Hide" : "Show"}
            </button>
          </div>

          {err && <div className="login-error">{err}</div>}

          <button
            className="login-button"
            type="submit"
            disabled={loading}
            style={{ backgroundColor: PRIMARY }}
          >
            {loading ? "Signing in..." : "LOGIN"}
          </button>
        </form>
      </div>
    </div>
  );
}
