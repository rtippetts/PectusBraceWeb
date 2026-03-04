// AddPatientPage.tsx (FULL drop-in replacement)
// Fix: send provider JWT to Edge Function so create-patient doesn't 401.

import React, { useState } from "react";
import { supabase } from "./supabaseClient";

export default function AddPatientPage() {
  const [secretId, setSecretId] = useState("");
  const [email, setEmail] = useState("");
  const [dispensedAt, setDispensedAt] = useState(() => new Date().toISOString().slice(0, 10)); // YYYY-MM-DD

  const [mode, setMode] = useState<"random" | "manual">("random");
  const [password, setPassword] = useState("");
  const [generated, setGenerated] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    setGenerated(null);
    setLoading(true);

    try {
      const sid = secretId.trim();
      const rawEmailOrUser = email.trim();
      const eml = rawEmailOrUser.includes("@")
        ? rawEmailOrUser.toLowerCase()
        : `${rawEmailOrUser}@bracetracker.com`;

      if (!sid) throw new Error("Secret ID is required.");
      if (!eml) throw new Error("Patient email/username is required.");

      if (mode === "manual" && password.trim().length < 8) {
        throw new Error("Password must be at least 8 characters.");
      }

      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) throw new Error("You are not logged in. Please log in again.");

      const payload = {
        secret_id: sid,
        patient_email: eml,
        password_mode: mode, // "random" | "manual" (matches your Edge Function Body type)
        password: mode === "manual" ? password : undefined,
        brace_dispensed_at: new Date(dispensedAt + "T00:00:00").toISOString(),
      };

      const { data, error } = await supabase.functions.invoke("create-patient", {
        body: payload,
      });

      if (error) {
        const ctx = (error as any).context as Response | undefined;
        let detail = "";
        if (ctx) {
          try {
            detail = await ctx.text();
          } catch {
            detail = "";
          }
        }

        throw new Error(detail || error.message || "Failed to create patient.");
      }

      if ((data as any)?.generated_password) setGenerated((data as any).generated_password);

      setOk(`Created patient ${sid}`);
      setSecretId("");
      setEmail("");
      setPassword("");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to create patient.");
    } finally {
      setLoading(false);
    }
  }

  async function copyGenerated() {
    if (!generated) return;
    await navigator.clipboard.writeText(generated);
    setOk("Copied password to clipboard.");
  }

  return (
    <div className="pageStub" style={{ maxWidth: 520 }}>
      <h2 style={{ marginTop: 0 }}>Add Patient</h2>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
        <input
          className="searchInput"
          placeholder="Secret ID (e.g., PC-0001)"
          value={secretId}
          onChange={(e) => setSecretId(e.target.value)}
        />

        <input
          className="searchInput"
          placeholder="Patient username or email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label style={{ fontSize: 12, color: "var(--muted)" }}>Brace dispensed date</label>
        <input
          className="searchInput"
          type="date"
          value={dispensedAt}
          onChange={(e) => setDispensedAt(e.target.value)}
        />

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
          <button
            type="button"
            className={"pill" + (mode === "random" ? " active" : "")}
            onClick={() => setMode("random")}
            disabled={loading}
          >
            Generate password
          </button>
          <button
            type="button"
            className={"pill" + (mode === "manual" ? " active" : "")}
            onClick={() => setMode("manual")}
            disabled={loading}
          >
            Enter password
          </button>
        </div>

        {mode === "manual" && (
          <input
            className="searchInput"
            placeholder="Patient password (min 8 chars)"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}

        {generated && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "#fbfcfe" }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
              Generated password (showing once):
            </div>
            <div style={{ fontWeight: 900, letterSpacing: 0.3 }}>{generated}</div>
            <button type="button" className="chip" style={{ marginTop: 10 }} onClick={copyGenerated}>
              Copy
            </button>
          </div>
        )}

        {err && <div style={{ color: "#E5533D", fontSize: 13 }}>{err}</div>}
        {ok && <div style={{ color: "#2FA36B", fontSize: 13 }}>{ok}</div>}

        <button className="primaryBtn" disabled={loading} type="submit">
          {loading ? "Creating..." : "Create Patient"}
        </button>
      </form>
    </div>
  );
}
