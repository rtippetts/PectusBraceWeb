// AddPatientPage.tsx (FULL drop-in replacement)
// Fix: send provider JWT to Edge Function so create-patient doesn't 401.

import React, { useState } from "react";
import { supabase } from "./supabaseClient";

function suggestId() {
  const animals = ["panda", "falcon", "otter", "maple", "cedar", "tiger", "nova", "ember", "river", "comet"];
  const word = animals[Math.floor(Math.random() * animals.length)];
  const n = Math.floor(10 + Math.random() * 90);
  return `${word}${n}`;
}

function suggestPassword(len = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*";
  let out = "";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (const n of arr) out += chars[n % chars.length];
  return out;
}

export default function AddPatientPage() {
  const [secretId, setSecretId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    setLoading(true);

    try {
      const sid = secretId.trim();
      const pw = password.trim();
      if (!sid) throw new Error("Secret ID is required.");
      if (!pw || pw.length < 8) throw new Error("Password must be at least 8 characters.");

      const patientEmail = `${sid.toLowerCase()}@bracetracker.com`;

      const payload = {
        secret_id: sid,
        patient_email: patientEmail,
        password_mode: "manual" as const,
        password: pw,
        brace_dispensed_at: new Date().toISOString(),
      };

      const { error } = await supabase.functions.invoke("create-patient", { body: payload });

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

      setOk(`Created patient ${sid}`);
      setSecretId("");
      setPassword("");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to create patient.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="pageStub"
      style={{
        width: "100%",
        minHeight: "calc(100vh - 140px)",
        padding: 24,
        display: "grid",
        placeItems: "center",
      }}
    >
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 14, width: "min(760px, 100%)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
          <input
            className="searchInput"
            placeholder="Secret ID"
            value={secretId}
            onChange={(e) => setSecretId(e.target.value)}
          />
          <button type="button" className="chip" onClick={() => setSecretId(suggestId())} disabled={loading}>
            Suggest ID
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
          <input
            className="searchInput"
            placeholder="Password"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="button" className="chip" onClick={() => setPassword(suggestPassword())} disabled={loading}>
            Suggest Password
          </button>
        </div>

        {err && <div style={{ color: "#E5533D", fontSize: 13 }}>{err}</div>}
        {ok && <div style={{ color: "#2FA36B", fontSize: 13 }}>{ok}</div>}

        <button className="primaryBtn" disabled={loading} type="submit">
          {loading ? "Creating..." : "Create Patient"}
        </button>
      </form>
    </div>
  );
}
