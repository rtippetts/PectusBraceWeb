// App.tsx (FULL drop-in replacement)
// Updates in this version (per your 4 requests):
// ✅ Rail is FIXED (does not scroll), toggle stays vertically centered
// ✅ Removed useless BT + Home icon boxes
// ✅ "Manage patients" is now a wide button BELOW the patient list (still has people icon)
// ✅ No patient selected by default; empty state says: "To begin please select a patient"
// ✅ All 6 stats + goal are in ONE compact row; Goal tile is RED and keeps edit behavior

import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  listPatientPhotos,
  signPhotoUrls,
  uploadPatientPhoto,
  formatDateLabel,
  type PhotoType,
  type PatientPhotoRow,
} from "./services/patientPhotos";

import LoginPage from "./LoginPage";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import "./App.css";
import { supabase } from "./supabaseClient";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

/* ========================= Brand colors ========================= */
const PRIMARY = "#d22d2d";

/* ========================= Types ========================= */
type SortMode = "PRIORITY" | "ALPHABETICAL";
type ChartRange = "1W" | "1M" | "6M" | "1Y" | "ALL";

type PatientRow = {
  id: string;
  secret_id: string;
  brace_dispensed_at: string;
  total_hours_worn: number;

  // computed from wear_sessions:
  days_fully_compliant: number;
  streak_days: number;
  today_hours: number;
  yesterday_hours: number;
  avg7_hours: number;

  last_sync_at: string | null;
  compliance_goal?: number | null;
};

type GoalHistoryRow = {
  goal: number;
  effective_at: string;
};

/* ========================= Icons (SVG) ========================= */

function IconPlus() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-.7-.7a2 2 0 0 0-2.8 0L4 16v4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M13.5 6.5 17.5 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 7h12M10 7V5h4v2M8 7l1 14h6l1-14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ========================= Chart helpers ========================= */

function startDateForRange(range: ChartRange) {
  const d = new Date();
  if (range === "1W") d.setDate(d.getDate() - 7);
  else if (range === "1M") d.setMonth(d.getMonth() - 1);
  else if (range === "6M") d.setMonth(d.getMonth() - 6);
  else if (range === "1Y") d.setFullYear(d.getFullYear() - 1);
  else return null;
  return d;
}

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addHoursByDay(map: Map<string, number>, start: Date, end: Date) {
  let cur = new Date(start);
  while (cur < end) {
    const dayStart = new Date(cur);
    dayStart.setHours(0, 0, 0, 0);

    const nextDay = new Date(dayStart);
    nextDay.setDate(nextDay.getDate() + 1);

    const segEnd = end < nextDay ? end : nextDay;
    const hours = (segEnd.getTime() - cur.getTime()) / 36e5;

    const key = toISODate(cur);
    map.set(key, (map.get(key) ?? 0) + hours);

    cur = segEnd;
  }
}

function buildGoalMapByDay(
  rangeStart: Date,
  rangeEnd: Date,
  goalHistory: GoalHistoryRow[],
  fallbackGoal: number,
  fallbackStartIso: string,
) {
  const normalized = [...goalHistory]
    .map((row) => ({
      goal: Number(row.goal),
      effectiveAt: new Date(row.effective_at),
    }))
    .filter((row) => Number.isFinite(row.goal) && Number.isFinite(row.effectiveAt.getTime()))
    .sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime());

  if (normalized.length === 0) {
    normalized.push({
      goal: fallbackGoal,
      effectiveAt: new Date(fallbackStartIso),
    });
  }

  const out = new Map<string, number>();
  const d = new Date(rangeStart);
  d.setHours(0, 0, 0, 0);
  const end = new Date(rangeEnd);
  end.setHours(0, 0, 0, 0);

  let idx = 0;
  let currentGoal = normalized[0]?.goal ?? fallbackGoal;

  while (d <= end) {
    const endOfDay = new Date(d);
    endOfDay.setHours(23, 59, 59, 999);

    while (idx < normalized.length && normalized[idx].effectiveAt.getTime() <= endOfDay.getTime()) {
      currentGoal = normalized[idx].goal;
      idx += 1;
    }

    out.set(toISODate(d), currentGoal);
    d.setDate(d.getDate() + 1);
  }

  return out;
}

function fillMissingDays(rangeStart: Date, rangeEnd: Date, hoursMap: Map<string, number>, goalMap: Map<string, number>) {
  const out: { date: string; hours: number; goal: number }[] = [];
  const d = new Date(rangeStart);
  d.setHours(0, 0, 0, 0);
  const end = new Date(rangeEnd);
  end.setHours(0, 0, 0, 0);

  while (d <= end) {
    const key = toISODate(d);
    out.push({
      date: key,
      hours: Math.round(((hoursMap.get(key) ?? 0) + Number.EPSILON) * 10) / 10,
      goal: Math.round(((goalMap.get(key) ?? 16) + Number.EPSILON) * 10) / 10,
    });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/* ========================= Patient helpers ========================= */

function daysSince(dateIso: string) {
  const start = new Date(dateIso);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function formatHours(hours: number) {
  return hours.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function statusFromPatient(p: PatientRow): "Critical" | "Warning" | "Normal" {
  if (!p.last_sync_at) return "Warning";
  const ms = Date.now() - new Date(p.last_sync_at).getTime();
  const days = ms / (1000 * 60 * 60 * 24);
  if (days >= 7) return "Critical";
  if (days >= 2) return "Warning";
  return "Normal";
}

function formatLastSync(p: PatientRow) {
  if (!p.last_sync_at) return "—";
  return new Date(p.last_sync_at).toLocaleString();
}

function agoLabel(isoOrNull: string | null) {
  if (!isoOrNull) return "—";
  const ms = Date.now() - new Date(isoOrNull).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function streakFromMap(hoursByDay: Map<string, number>, goal: number) {
  let streak = 0;
  const d = new Date();
  d.setHours(0, 0, 0, 0);

  while (true) {
    const key = toISODate(d);
    const hrs = hoursByDay.get(key) ?? 0;
    if (hrs >= goal) {
      streak += 1;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function avg7FromMap(hoursByDay: Map<string, number>) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);

  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const key = toISODate(d);
    sum += hoursByDay.get(key) ?? 0;
    d.setDate(d.getDate() - 1);
  }
  return sum / 7;
}

/* ========================= Password generator ========================= */

const WORDS = [
  "Panda", "Rocket", "Maple", "Cedar", "Falcon", "Nimbus", "Cobalt", "Juniper",
  "Tiger", "Aurora", "Comet", "Quartz", "Violet", "Summit", "River", "Sparrow",
];
const SYMBOLS = ["!", "@", "#", "$", "%", "&", "*", "?"];

function suggestPassword() {
  const w = WORDS[Math.floor(Math.random() * WORDS.length)];
  const n = Math.floor(Math.random() * 90) + 10;
  const s = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
  return `${w}${n}${s}`;
}

function suggestSecretId() {
  const w = WORDS[Math.floor(Math.random() * WORDS.length)].toLowerCase();
  const n = Math.floor(Math.random() * 900) + 100;
  return `${w}${n}`;
}

/* ========================= App Root ========================= */

export default function App() {
  const [sessionChecked, setSessionChecked] = useState(false);
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionChecked(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
      setSessionChecked(true);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  if (!sessionChecked) return null;

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/*" element={session ? <AuthedShell /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}

/* ========================= Authed Shell ========================= */

function AuthedShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [rows, setRows] = useState<PatientRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [patientPaneCollapsed, setPatientPaneCollapsed] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PatientRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PatientRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [chartRange, setChartRange] = useState<ChartRange>("1M");
  const onPatientScopedPage = location.pathname === "/patient" || location.pathname === "/photos" || location.pathname === "/scans";
  async function loadPatients() {
    setLoading(true);
    setErr(null);
    try {
      type BasicPatient = {
        id: string;
        secret_id: string;
        brace_dispensed_at: string;
        compliance_goal: number | null;
        created_at: string;
      };
      const [directRes, linkedRes] = await Promise.all([
        supabase
          .from("patients")
          .select("id, secret_id, brace_dispensed_at, compliance_goal, created_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("provider_patients")
          .select("patient:patients(id,secret_id,brace_dispensed_at,compliance_goal,created_at)"),
      ]);
      if (directRes.error && linkedRes.error) {
        throw new Error(directRes.error.message || linkedRes.error.message);
      }
      const patientsById = new Map<string, BasicPatient>();
      if (!directRes.error) {
        for (const p of (directRes.data ?? []) as BasicPatient[]) patientsById.set(p.id, p);
      }
      if (!linkedRes.error) {
        const linkedPatients = (linkedRes.data ?? [])
          .map((r: any) => r?.patient)
          .filter(Boolean) as BasicPatient[];
        for (const p of linkedPatients) patientsById.set(p.id, p);
      }
      const patients = [...patientsById.values()];
      if (patients.length === 0) {
        setRows([]);
        setSelectedId("");
        return;
      }
      const patientIds = patients.map((p) => p.id);
      const { data: sessions, error: sessErr } = await supabase
        .from("wear_sessions")
        .select("patient_id, start_time, end_time")
        .in("patient_id", patientIds);
      if (sessErr) throw new Error(sessErr.message);
      const nowMs = Date.now();
      const totalHoursByPatient = new Map<string, number>();
      const lastSyncByPatient = new Map<string, number>();
      const hoursByDayByPatient = new Map<string, Map<string, number>>();
      function getDayMap(pid: string) {
        const existing = hoursByDayByPatient.get(pid);
        if (existing) return existing;
        const m = new Map<string, number>();
        hoursByDayByPatient.set(pid, m);
        return m;
      }
      for (const s of (sessions ?? []) as any[]) {
        const pid = s.patient_id as string;
        const startMs = new Date(s.start_time).getTime();
        const endMs = s.end_time ? new Date(s.end_time).getTime() : nowMs;
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
        const hrs = (endMs - startMs) / 36e5;
        totalHoursByPatient.set(pid, (totalHoursByPatient.get(pid) ?? 0) + hrs);
        const candidateLast = s.end_time ? endMs : startMs;
        lastSyncByPatient.set(pid, Math.max(lastSyncByPatient.get(pid) ?? 0, candidateLast));
        const dayMap = getDayMap(pid);
        addHoursByDay(dayMap, new Date(s.start_time), s.end_time ? new Date(s.end_time) : new Date());
      }
      const todayKey = toISODate(new Date());
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const yKey = toISODate(y);
      const rowsBuilt: PatientRow[] = patients.map((p) => {
        const goal = p.compliance_goal ?? 16;
        const total = totalHoursByPatient.get(p.id) ?? 0;
        const last = lastSyncByPatient.get(p.id);
        const dayMap = hoursByDayByPatient.get(p.id) ?? new Map<string, number>();
        let compliantDays = 0;
        for (const hrs of dayMap.values()) if (hrs >= goal) compliantDays += 1;
        const todayHrs = dayMap.get(todayKey) ?? 0;
        const yHrs = dayMap.get(yKey) ?? 0;
        const avg7 = avg7FromMap(dayMap);
        const streak = streakFromMap(dayMap, goal);
        return {
          id: p.id,
          secret_id: p.secret_id,
          brace_dispensed_at: p.brace_dispensed_at,
          total_hours_worn: Math.round((total + Number.EPSILON) * 10) / 10,
          days_fully_compliant: compliantDays,
          streak_days: streak,
          today_hours: Math.round((todayHrs + Number.EPSILON) * 10) / 10,
          yesterday_hours: Math.round((yHrs + Number.EPSILON) * 10) / 10,
          avg7_hours: Math.round((avg7 + Number.EPSILON) * 10) / 10,
          last_sync_at: last ? new Date(last).toISOString() : null,
          compliance_goal: p.compliance_goal,
        };
      });
      setRows(rowsBuilt);
      setSelectedId((prev) => (prev && rowsBuilt.some((r) => r.id === prev) ? prev : ""));
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load patients.");
    } finally {
      setLoading(false);
    }
  }
  async function updateGoal(patientId: string, newGoal: number) {
    const goal = Math.max(1, Math.min(24, Number(newGoal)));
    setRows((prev) => prev.map((p) => (p.id === patientId ? { ...p, compliance_goal: goal } : p)));
    try {
      const { error } = await supabase.from("patients").update({ compliance_goal: goal }).eq("id", patientId);
      if (error) throw error;

      const { error: historyError } = await supabase.from("patient_goal_history").insert({
        patient_id: patientId,
        goal,
        effective_at: new Date().toISOString(),
      });

      if (historyError && !historyError.message.toLowerCase().includes("patient_goal_history")) {
        throw historyError;
      }

      await loadPatients();
    } catch (e: any) {
      await loadPatients();
      throw new Error(e?.message ?? "Failed to update compliance goal.");
    }
  }
  useEffect(() => {
    loadPatients();
  }, []);
  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);
  const patientList = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    const base = rows.filter((p) => !q || p.secret_id.toLowerCase().includes(q));
    return [...base].sort((a, b) => a.secret_id.localeCompare(b.secret_id));
  }, [listQuery, rows]);
  const routeTitle =
    onPatientScopedPage
      ? selected?.secret_id ?? "Select patient from list"
      : location.pathname === "/profile"
        ? "Edit Profile"
        : "Patient";
  return (
    <div style={{ minHeight: "100vh", background: "#f6f8fc", display: "flex" }}>
      <aside
        style={{
          width: 92,
          background: PRIMARY,
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "14px 0",
          gap: 14,
          boxShadow: "8px 0 24px rgba(15,23,42,0.12)",
          position: "sticky",
          top: 0,
          height: "100vh",
          zIndex: 20,
        }}
      >
        <RailProfile onOpenProfile={() => navigate("/profile")} />
        <div style={{ flex: 1, display: "grid", alignContent: "center", width: "100%" }}>
          <div style={{ display: "grid", gap: 28, width: "100%" }}>
            <RailNavButton
              label="Patient"
              active={location.pathname === "/patient" || location.pathname === "/"}
              onClick={() => navigate("/patient")}
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M4 20V11" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  <path d="M10 20V7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  <path d="M16 20V14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  <path d="M22 20V4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              }
            />
            <RailNavButton
              label="Photos"
              active={location.pathname === "/photos"}
              onClick={() => navigate("/photos")}
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 8.5h3l1.4-2h5.2l1.4 2H19a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6.5a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  <circle cx="12" cy="13" r="3.25" stroke="currentColor" strokeWidth="2" />
                  <circle cx="17.6" cy="10.4" r="0.9" fill="currentColor" />
                </svg>
              }
            />
            <RailNavButton
              label="3D Scans"
              active={location.pathname === "/scans"}
              onClick={() => navigate("/scans")}
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 3 19 7v10l-7 4-7-4V7l7-4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M12 12 19 7M12 12 5 7M12 12v9" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                </svg>
              }
            />
          </div>
        </div>
        <RailNavButton
          label="Reload"
          active={false}
          onClick={() => void loadPatients()}
          highlightOnHover
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M20 12a8 8 0 1 1-2.35-5.66" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
              <path d="M20 4v5h-5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
        />
      </aside>
      {onPatientScopedPage && (
        <PatientListPane
          collapsed={patientPaneCollapsed}
          setCollapsed={setPatientPaneCollapsed}
          rows={patientList}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
          loading={loading}
          err={err}
          query={listQuery}
          setQuery={setListQuery}
          onCreate={() => setCreateOpen(true)}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <header
          style={{
            height: 78,
            borderBottom: "1px solid #e6ebf2",
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 22px",
          }}
        >
          <div>
            <div
              style={{
                fontWeight: 900,
                fontSize: onPatientScopedPage ? 42 : 20,
                color: onPatientScopedPage ? PRIMARY : "#0f172a",
                lineHeight: 1,
              }}
            >
              {routeTitle}
            </div>
          </div>
          <div style={{ minWidth: 40, display: "flex", justifyContent: "flex-end" }}>
            {onPatientScopedPage && selected ? (
              <button
                type="button"
                onClick={() => setEditTarget(selected)}
                title="Edit selected patient"
                aria-label="Edit selected patient"
                style={{
                  width: 44,
                  height: 44,
                  border: "none",
                  background: "transparent",
                  color: PRIMARY,
                  display: "grid",
                  placeItems: "center",
                  cursor: "pointer",
                }}
              >
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 20h4l10-10a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  <path d="M12.5 7.5 16.5 11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            ) : null}
          </div>
        </header>
        <main style={{ padding: 20 }}>
          <Routes>
            <Route path="/" element={<Navigate to="/patient" replace />} />
            <Route
              path="/patient"
              element={
                <DashboardDetail
                  selected={selected}
                  chartRange={chartRange}
                  setChartRange={setChartRange}
                  onUpdateGoal={updateGoal}
                />
              }
            />
            <Route path="/photos" element={<PatientPhotosPage selected={selected} />} />
            <Route path="/scans" element={<PatientScansPage selected={selected} />} />
            <Route path="/add" element={<Navigate to="/patient" replace />} />
            <Route path="/profile" element={<EditProfilePage />} />
            <Route path="*" element={<Navigate to="/patient" replace />} />
          </Routes>
        </main>
      </div>
      {createOpen && (
        <CreatePatientModal
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            setCreateOpen(false);
            await loadPatients();
          }}
        />
      )}
      {editTarget && (
        <EditPatientModal
          patient={editTarget}
          onClose={() => setEditTarget(null)}
          onDelete={() => {
            setDeleteTarget(editTarget);
            setEditTarget(null);
          }}
          onSaved={async () => {
            setEditTarget(null);
            await loadPatients();
          }}
        />
      )}
      {deleteTarget && (
        <DeletePatientModal
          patient={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={async () => {
            setDeleteTarget(null);
            await loadPatients();
          }}
        />
      )}
    </div>
  );
}
function RailProfile({ onOpenProfile }: { onOpenProfile: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (!target) return;
      if (wrapRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);
  async function handleLogout() {
    setOpen(false);
    await supabase.auth.signOut();
    navigate("/login");
  }
  const name = (email.split("@")[0] || "Provider").replace(/\./g, " ");
  const initials = (name[0] ?? "P").toUpperCase();
  return (
    <div ref={wrapRef} style={{ width: "100%", position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          border: "none",
          background: "transparent",
          color: "#fff",
          display: "grid",
          placeItems: "center",
          gap: 10,
          cursor: "pointer",
          padding: 6,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 999,
            background: "rgba(255,255,255,0.15)",
            border: "1px solid rgba(255,255,255,0.35)",
            display: "grid",
            placeItems: "center",
            fontWeight: 900,
          }}
        >
          {initials}
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, textAlign: "center", lineHeight: 1.2, maxWidth: 78, wordBreak: "break-word" }}>
          {name || "Provider"}
        </div>
      </button>
      {open && (
        <div
          ref={menuRef}
          style={{
            position: "absolute",
            left: "calc(100% + 12px)",
            top: 0,
            minWidth: 170,
            background: "#fff",
            borderRadius: 12,
            border: "1px solid #dbe3ee",
            boxShadow: "0 18px 34px rgba(15,23,42,0.16)",
            padding: 8,
            zIndex: 50,
          }}
        >
          <button
            className="chip"
            type="button"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              setOpen(false);
              onOpenProfile();
            }}
          >
            Edit profile
          </button>
          <button
            className="chip"
            type="button"
            style={{ width: "100%", justifyContent: "flex-start", marginTop: 6, color: "#E5533D", borderColor: "rgba(229,83,61,0.35)" }}
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
function RailNavButton({
  label,
  active,
  onClick,
  icon,
  highlightOnHover = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  highlightOnHover?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const bright = active || (highlightOnHover && (hovered || pressed));

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        width: "100%",
        height: 54,
        borderRadius: 14,
        border: "none",
        background: "transparent",
        color: bright ? "#ffffff" : "rgba(255,255,255,0.58)",
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
        position: "relative",
      }}
    >
      {active && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            top: "50%",
            transform: "translateY(-50%)",
            width: 6,
            height: 42,
            borderRadius: 0,
            background: "#1F3A5F",
          }}
        />
      )}
      <span style={{ display: "grid", placeItems: "center", transform: "scale(2)" }}>{icon}</span>
    </button>
  );
}
function PatientListPane({
  collapsed,
  setCollapsed,
  rows,
  selectedId,
  onSelect,
  loading,
  err,
  query,
  setQuery,
  onCreate,
}: {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  rows: PatientRow[];
  selectedId: string;
  onSelect: (id: string) => void;
  loading: boolean;
  err: string | null;
  query: string;
  setQuery: (v: string) => void;
  onCreate: () => void;
}) {
  const grouped = useMemo(() => {
    const m = new Map<string, PatientRow[]>();
    for (const p of rows) {
      const k = (p.secret_id[0] || "#").toUpperCase();
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const letterIndex = useMemo(() => "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), []);
  const availableLetters = useMemo(() => new Set(grouped.map(([letter]) => letter)), [grouped]);
  const [showCollapseTip, setShowCollapseTip] = useState(false);
  const collapseTipTimer = useRef<number | null>(null);

  function onCollapseHoverStart() {
    if (collapseTipTimer.current) window.clearTimeout(collapseTipTimer.current);
    collapseTipTimer.current = window.setTimeout(() => setShowCollapseTip(true), 200);
  }

  function onCollapseHoverEnd() {
    if (collapseTipTimer.current) {
      window.clearTimeout(collapseTipTimer.current);
      collapseTipTimer.current = null;
    }
    setShowCollapseTip(false);
  }
  return (
    <aside
      style={{
        width: collapsed ? 32 : 320,
        transition: "width 0.18s ease",
        borderRight: "1px solid #e7ecf4",
        background: "#fff",
        height: "100vh",
        position: "sticky",
        top: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
        {!collapsed && <div style={{ fontWeight: 900, fontSize: 27, color: "#0f172a", lineHeight: 1 }}>Patients</div>}
        {!collapsed && (
          <button
            type="button"
            onClick={onCreate}
            aria-label="Add patient"
            title="Add patient"
            style={{
              width: 32,
              height: 32,
              border: "none",
              background: "transparent",
              color: PRIMARY,
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              fontSize: 28,
              lineHeight: 1,
              fontWeight: 700,
              padding: 0,
            }}
          >
            +
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? "Expand patient list" : "Collapse patient list"}
        onMouseEnter={onCollapseHoverStart}
        onMouseLeave={onCollapseHoverEnd}
        onBlur={onCollapseHoverEnd}
        style={{
          position: "absolute",
          right: -28,
          top: "50%",
          transform: "translateY(-50%)",
          width: 28,
          height: 72,
          padding: 0,
          display: "grid",
          placeItems: "center",
          border: "1px solid #d9e1ee",
          borderLeft: "none",
          borderRadius: "0 10px 10px 0",
          background: "#fff",
          color: "#64748b",
          cursor: "pointer",
          boxShadow: "8px 0 20px rgba(15, 23, 42, 0.08)",
          zIndex: 35,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {collapsed ? (
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
      </button>
      {showCollapseTip && (
        <div
          style={{
            position: "absolute",
            right: -88,
            top: "50%",
            transform: "translateY(-50%)",
            background: "#0f172a",
            color: "#fff",
            fontSize: 11,
            padding: "4px 8px",
            borderRadius: 6,
            whiteSpace: "nowrap",
            zIndex: 36,
          }}
        >
          {collapsed ? "Expand" : "Collapse"}
        </div>
      )}
      {!collapsed && (
        <>
          <div style={{ padding: 12 }}>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 10, top: 10, color: "#9aa5b1", lineHeight: 0 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                  <path d="M20 20l-3.7-3.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
              <input
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  border: "none",
                  background: "#eef1f4",
                  color: "#0f172a",
                  borderRadius: 8,
                  height: 34,
                  padding: "0 12px 0 32px",
                  outline: "none",
                  fontSize: 13,
                }}
              />
            </div>
          </div>
          <div style={{ flex: 1, overflow: "hidden", padding: "0 10px 10px", display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
            <div style={{ overflowY: "auto", paddingRight: 4 }}>
              {loading && <div style={{ color: "#64748b", padding: 10 }}>Loading...</div>}
              {err && <div style={{ color: "#E5533D", padding: 10 }}>{err}</div>}
              {!loading &&
                !err &&
                grouped.map(([letter, patients]) => (
                  <div key={letter} id={`letter-${letter}`} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 900, padding: "2px 8px" }}>{letter}</div>
                    {patients.map((p) => (
                      <div
                        key={p.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelect(p.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") onSelect(p.id);
                        }}
                        style={{
                          border: "none",
                          borderRadius: 10,
                          padding: "10px 10px",
                          marginBottom: 6,
                          cursor: "pointer",
                          position: "relative",
                          background: p.id === selectedId ? "#1F3A5F" : "#fff",
                          color: p.id === selectedId ? "#fff" : "#0f172a",
                        }}
                      >
                        {p.id === selectedId ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "nowrap" }}>
                            <div
                              style={{
                                fontWeight: 800,
                                fontSize: 19.2,
                                lineHeight: 1.1,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {p.secret_id}
                            </div>
                            <div
                              aria-hidden="true"
                              style={{
                                width: 1,
                                alignSelf: "stretch",
                                minHeight: 16,
                                background: "rgba(255,255,255,0.55)",
                              }}
                            />
                            <div
                              style={{
                                fontSize: 12,
                                opacity: 0.92,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {(() => {
                                const months = Math.max(0, Math.floor(daysSince(p.brace_dispensed_at) / 30));
                                return `Braced ${months} month${months === 1 ? "" : "s"} ago`;
                              })()}
                            </div>
                          </div>
                        ) : (
                          <>
                            <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1.1 }}>{p.secret_id}</div>
                            <div style={{ fontSize: 12, marginTop: 2, opacity: 0.64 }}>
                              {(() => {
                                const months = Math.max(0, Math.floor(daysSince(p.brace_dispensed_at) / 30));
                                return `Braced ${months} month${months === 1 ? "" : "s"} ago`;
                              })()}
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
            </div>
            <div style={{ width: 12, paddingTop: 2, color: "#64748b", fontSize: 11, fontWeight: 800, display: "grid", gap: 4, alignContent: "start" }}>
              {letterIndex.map((letter) => {
                const hasAny = availableLetters.has(letter);
                return hasAny ? (
                  <a
                    key={letter}
                    href={`#letter-${letter}`}
                    style={{ color: "#475569", textDecoration: "none", textAlign: "center" }}
                  >
                    {letter}
                  </a>
                ) : (
                  <span key={letter} style={{ color: "#c4cedb", textAlign: "center", userSelect: "none" }}>
                    {letter}
                  </span>
                );
              })}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
function EditProfilePage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const em = data.user?.email ?? "";
      setEmail(em);
      setName((em.split("@")[0] || "Provider").replace(/\./g, " "));
    });
  }, []);
  return (
    <section style={{ maxWidth: 780, margin: "0 auto" }}>
      <div style={{ background: "#fff", border: "1px solid #e5ebf4", borderRadius: 16, padding: 18, display: "grid", gap: 12 }}>
        <div style={{ fontWeight: 900, fontSize: 18 }}>Provider Profile</div>
        <div style={{ color: "#64748b", fontSize: 13 }}>Name and image can be adjusted here. Email is managed by Auth.</div>
        <div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Display Name</div>
          <input className="searchInput" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Email</div>
          <input className="searchInput" value={email} disabled />
        </div>
        <button
          type="button"
          className="primaryBtn"
          style={{ background: PRIMARY, width: "fit-content" }}
          onClick={() => setMsg("Saved locally for now. We can wire backend profile persistence next.")}
        >
          Save Profile
        </button>
        {msg && <div style={{ color: "#2FA36B", fontSize: 13 }}>{msg}</div>}
      </div>
    </section>
  );
}
/* ========================= Dashboard Detail ========================= */

function PatientRequiredEmptyState() {
  return (
    <div
      style={{
        minHeight: "calc(100vh - 72px - 36px)",
        display: "grid",
        placeItems: "center",
        color: "rgba(100,116,139,0.6)",
        fontWeight: 800,
        fontSize: 28,
        textAlign: "center",
      }}
    >
      To begin please select a patient
    </div>
  );
}

function DashboardDetail({
  selected,
  chartRange,
  setChartRange,
  onUpdateGoal,
}: {
  selected: PatientRow | null;
  chartRange: ChartRange;
  setChartRange: (r: ChartRange) => void;
  onUpdateGoal: (patientId: string, newGoal: number) => Promise<void>;
}) {
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState<number>(16);
  const [savingGoal, setSavingGoal] = useState(false);
  const [goalErr, setGoalErr] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) return;
    setGoalDraft(selected.compliance_goal ?? 16);
    setEditingGoal(false);
    setGoalErr(null);
  }, [selected?.id]);

  // ✅ Empty state copy EXACTLY as requested
  if (!selected) return <PatientRequiredEmptyState />;

  const selectedPatient = selected;
  const goal = selectedPatient.compliance_goal ?? 16;

  async function saveGoal() {
    setGoalErr(null);
    setSavingGoal(true);
    try {
      const g = Math.max(1, Math.min(24, Number(goalDraft)));
      await onUpdateGoal(selectedPatient.id, g);
      setEditingGoal(false);
    } catch (e: any) {
      setGoalErr(e?.message ?? "Failed to update goal.");
    } finally {
      setSavingGoal(false);
    }
  }

  return (
    <section className="detail" style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* ✅ One compact row: 6 stats + goal */}
      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          alignItems: "stretch",
        }}
      >
        <MiniMetricCard title="Today" value={formatHours(selectedPatient.today_hours)} sub="hrs" />
        <MiniMetricCard title="Yesterday" value={formatHours(selectedPatient.yesterday_hours)} sub="hrs" />
        <MiniMetricCard title="7d avg" value={formatHours(selectedPatient.avg7_hours)} sub="hrs" />
        <MiniMetricCard title="Streak" value={selectedPatient.streak_days} sub="days" />
        <MiniMetricCard title="Compliant" value={selectedPatient.days_fully_compliant} sub="days" />
        <MiniMetricCard title="Total" value={formatHours(selectedPatient.total_hours_worn)} sub="hrs" />

        {/* Goal tile (stands out, red, keeps edit) */}
        <div
          style={{
            borderRadius: 16,
            border: "1px solid rgba(210,45,45,0.35)",
            background: PRIMARY,
            color: "#fff",
            padding: 12,
            display: "grid",
            alignContent: "space-between",
            minHeight: 92,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.2, opacity: 0.95 }}>Goal</div>

            {!editingGoal ? (
              <button
                type="button"
                onClick={() => setEditingGoal(true)}
                style={{
                  border: "1px solid rgba(255,255,255,0.35)",
                  background: "rgba(255,255,255,0.12)",
                  color: "#fff",
                  fontWeight: 900,
                  borderRadius: 999,
                  padding: "6px 10px",
                  cursor: "pointer",
                }}
                title="Edit goal"
              >
                Edit
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditingGoal(false);
                  setGoalErr(null);
                  setGoalDraft(goal);
                }}
                disabled={savingGoal}
                style={{
                  border: "1px solid rgba(255,255,255,0.35)",
                  background: "rgba(255,255,255,0.10)",
                  color: "#fff",
                  fontWeight: 900,
                  borderRadius: 999,
                  padding: "6px 10px",
                  cursor: "pointer",
                  opacity: savingGoal ? 0.7 : 1,
                }}
              >
                Cancel
              </button>
            )}
          </div>

          {!editingGoal ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontSize: 28, fontWeight: 950, lineHeight: 1 }}>{goal}</div>
              <div style={{ fontSize: 12, opacity: 0.9, fontWeight: 900 }}>hrs/day</div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={goalDraft}
                  onChange={(e) => setGoalDraft(Number(e.target.value))}
                  style={{
                    width: "100%",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.35)",
                    padding: "8px 10px",
                    outline: "none",
                    fontWeight: 900,
                    background: "rgba(255,255,255,0.12)",
                    color: "#fff",
                  }}
                />
                <button
                  type="button"
                  onClick={saveGoal}
                  disabled={savingGoal}
                  style={{
                    border: "none",
                    borderRadius: 12,
                    padding: "8px 12px",
                    fontWeight: 950,
                    cursor: "pointer",
                    background: "#fff",
                    color: PRIMARY,
                    opacity: savingGoal ? 0.75 : 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {savingGoal ? "Saving…" : "Save"}
                </button>
              </div>
              {goalErr && <div style={{ color: "rgba(255,255,255,0.95)", fontSize: 12 }}>{goalErr}</div>}
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="trendCard" style={{ marginTop: 14 }}>
        <div className="trendHeader">
          <div className="trendTitle">Wearing Trends</div>
          <div className="trendControls">
            {(["1W", "1M", "6M", "1Y", "ALL"] as ChartRange[]).map((r) => (
              <button
                key={r}
                className={"chip" + (chartRange === r ? " active" : "")}
                type="button"
                onClick={() => setChartRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="trendPlaceholder" style={{ height: 340 }}>
          <WearChart
            patientId={selectedPatient.id}
            range={chartRange}
            goal={goal}
            braceDispensedAt={selectedPatient.brace_dispensed_at}
          />
        </div>
      </div>
    </section>
  );
}

function PatientPhotosPage({ selected }: { selected: PatientRow | null }) {
  if (!selected) return <PatientRequiredEmptyState />;

  return (
    <section style={{ maxWidth: 1200, margin: "0 auto" }}>
      <PhotoPanel patientId={selected.id} />
    </section>
  );
}

function PatientScansPage({ selected }: { selected: PatientRow | null }) {
  if (!selected) return <PatientRequiredEmptyState />;

  return (
    <section style={{ maxWidth: 1200, margin: "0 auto" }}>
      <div
        style={{
          borderRadius: 18,
          border: "1px solid rgba(15, 23, 42, 0.10)",
          background: "#fff",
          padding: 24,
          minHeight: 320,
          display: "grid",
          alignContent: "start",
          gap: 14,
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 24, color: "#0f172a" }}>3D Scans</div>
        <div style={{ color: "#64748b", maxWidth: 620 }}>
          This page is ready for patient-specific 3D scan uploads, previews, and scan history. The scan workflow itself still needs backend support.
        </div>
        <div
          style={{
            borderRadius: 16,
            border: "1px dashed rgba(15, 23, 42, 0.18)",
            background: "#f8fafc",
            minHeight: 220,
            display: "grid",
            placeItems: "center",
            color: "#94a3b8",
            fontWeight: 700,
          }}
        >
          No 3D scans yet
        </div>
      </div>
    </section>
  );
}

/* ========================= Chart Component ========================= */

function WearChart({
  patientId,
  range,
  goal,
  braceDispensedAt,
}: {
  patientId: string;
  range: ChartRange;
  goal: number;
  braceDispensedAt: string;
}) {
  const [data, setData] = useState<{ date: string; hours: number; goal: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      const start = startDateForRange(range);

      let q = supabase
        .from("wear_sessions")
        .select("start_time, end_time")
        .eq("patient_id", patientId)
        .order("start_time", { ascending: true });

      if (start) q = q.gte("start_time", start.toISOString());

      const [{ data: rows, error }, goalHistoryRes] = await Promise.all([
        q,
        supabase
          .from("patient_goal_history")
          .select("goal, effective_at")
          .eq("patient_id", patientId)
          .order("effective_at", { ascending: true }),
      ]);

      if (cancelled) return;
      setLoading(false);

      if (error) return setErr(error.message);

      const now = new Date();
      const hoursMap = new Map<string, number>();

      for (const r of rows ?? []) {
        const s = new Date((r as any).start_time);
        const e = (r as any).end_time ? new Date((r as any).end_time) : now;
        if (e <= s) continue;
        addHoursByDay(hoursMap, s, e);
      }

      let rangeStart = start ?? now;
      if (!start && (rows ?? []).length > 0) rangeStart = new Date((rows as any)[0].start_time);

      const goalHistory =
        goalHistoryRes.error && goalHistoryRes.error.message.toLowerCase().includes("patient_goal_history")
          ? []
          : ((goalHistoryRes.data ?? []) as GoalHistoryRow[]);

      const goalMap = buildGoalMapByDay(rangeStart, now, goalHistory, goal, braceDispensedAt);

      setData(fillMissingDays(rangeStart, now, hoursMap, goalMap));
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [braceDispensedAt, goal, patientId, range]);

  if (loading) return <div style={{ padding: 12, color: "var(--muted)" }}>Loading chart…</div>;
  if (err) return <div style={{ padding: 12, color: "#E5533D" }}>{err}</div>;
  if (!data.length) return <div style={{ padding: 12, color: "var(--muted)" }}>No wear data yet.</div>;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} minTickGap={24} />
        <YAxis domain={[0, 24]} tickCount={7} label={{ value: "Hours", angle: -90, position: "insideLeft" }} />
        <Tooltip formatter={(value: any) => [`${value} hrs`, "Worn"]} labelFormatter={(label) => `Date: ${label}`} />
        <Line type="stepAfter" dataKey="goal" stroke="#94a3b8" strokeWidth={2} strokeDasharray="6 6" dot={false} />
        <Line type="monotone" dataKey="hours" stroke={PRIMARY} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ========================= Photos Panel =========================
   Requires a Supabase Storage bucket named: "patient-photos"
*/

function PhotoPanel({ patientId }: { patientId: string }) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [rows, setRows] = useState<PatientPhotoRow[]>([]);
  const [urlsByPath, setUrlsByPath] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Upload modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [photoType, setPhotoType] = useState<PhotoType>("Progress");
  const [capturedDate, setCapturedDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  async function refresh() {
    setLoading(true);
    setErr(null);

    try {
      const list = await listPatientPhotos(patientId, 48);
      setRows(list);

      const paths = list.map((r) => r.storage_path);
      const signed = await signPhotoUrls(paths, 60 * 60);
      setUrlsByPath(signed);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load photos.");
      setRows([]);
      setUrlsByPath({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  function openUpload() {
    setPhotoType("Progress");
    setCapturedDate(new Date().toISOString().slice(0, 10));
    setNote("");
    setPendingFile(null);
    setModalOpen(true);
  }

  function closeUpload() {
    setModalOpen(false);
    setPendingFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function doUpload() {
    if (!pendingFile) {
      setErr("Please choose a file.");
      return;
    }

    setUploading(true);
    setErr(null);

    try {
      const d = new Date(capturedDate + "T00:00:00Z");
      await uploadPatientPhoto({
        patientId,
        file: pendingFile,
        photoType,
        capturedDate: d,
        note: note.trim() ? note.trim() : undefined,
      });

      closeUpload();
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Upload failed (likely Storage policy/RLS).");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      style={{
        marginTop: 14,
        borderRadius: 18,
        border: "1px solid rgba(15, 23, 42, 0.10)",
        background: "#fff",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: 14,
          borderBottom: "1px solid #e6ebf2",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div style={{ fontWeight: 900 }}>Photos</div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            className="chip"
            type="button"
            onClick={openUpload}
            disabled={uploading}
            style={{
              border: "1px solid rgba(210,45,45,0.25)",
              color: PRIMARY,
              background: "rgba(210,45,45,0.06)",
              fontWeight: 900,
              whiteSpace: "nowrap",
            }}
          >
            Add photo
          </button>

          <button className="chip" type="button" onClick={refresh} disabled={uploading}>
            Refresh
          </button>
        </div>
      </div>

      <div style={{ padding: 14 }}>
        {loading && <div style={{ color: "var(--muted)" }}>Loading photos…</div>}
        {err && <div style={{ color: "#E5533D", fontSize: 13, marginBottom: 10 }}>{err}</div>}

        {!loading && !err && rows.length === 0 && (
          <div style={{ color: "#64748b" }}>
            No photos yet. Click <strong>Add photo</strong> to upload.
          </div>
        )}

        {rows.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
            {rows.map((r) => {
              const url = urlsByPath[r.storage_path];
              const label = formatDateLabel(r.captured_at);

              const fileName = r.storage_path.split("/").pop() || "";
              const typePart = (fileName.split("_")[1] || "").replace(/\-.+$/, "");
              const typeLabel = typePart ? typePart.toUpperCase() : "";

              return (
                <a
                  key={r.id}
                  href={url || "#"}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    borderRadius: 14,
                    border: "1px solid rgba(15, 23, 42, 0.10)",
                    overflow: "hidden",
                    display: "block",
                    background: "#fff",
                    textDecoration: "none",
                    color: "inherit",
                    opacity: url ? 1 : 0.6,
                  }}
                  title={url ? "Open" : "Signing…"}
                >
                  <div style={{ padding: "10px 10px 8px", borderBottom: "1px solid #eef2f7" }}>
                    <div style={{ fontWeight: 900, fontSize: 13 }}>{label}</div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>{typeLabel || "PHOTO"}</div>
                  </div>

                  {url ? (
                    <img
                      src={url}
                      alt="Patient"
                      style={{ width: "100%", height: 160, objectFit: "cover", display: "block" }}
                    />
                  ) : (
                    <div style={{ height: 160, display: "grid", placeItems: "center", color: "#94a3b8" }}>
                      Loading…
                    </div>
                  )}
                </a>
              );
            })}
          </div>
        )}
      </div>

      {modalOpen && (
        <ModalShell
          title="Add Photo"
          onClose={uploading ? () => { } : closeUpload}
          footer={
            <>
              <button className="chip" type="button" onClick={closeUpload} disabled={uploading}>
                Cancel
              </button>
              <button
                className="primaryBtn"
                type="button"
                onClick={doUpload}
                disabled={uploading || !pendingFile}
                style={{ background: PRIMARY }}
              >
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </>
          }
          width={560}
        >
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginBottom: 6 }}>
                  Photo type (optional)
                </div>
                <select className="searchInput" value={photoType} onChange={(e) => setPhotoType(e.target.value as PhotoType)}>
                  <option value="Progress">Progress</option>
                  <option value="Front">Front</option>
                  <option value="Side">Side</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginBottom: 6 }}>
                  Captured date (optional)
                </div>
                <input className="searchInput" type="date" value={capturedDate} onChange={(e) => setCapturedDate(e.target.value)} />
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginBottom: 6 }}>
                Note (optional)
              </div>
              <input className="searchInput" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Short note (optional)" />
            </div>

            <div>
              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginBottom: 6 }}>
                Choose file
              </div>

              <button
                className="chip"
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                style={{
                  border: "1px solid rgba(15, 23, 42, 0.12)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                Select image…
              </button>

              <span style={{ marginLeft: 10, fontSize: 13, color: "#334155" }}>
                {pendingFile ? pendingFile.name : "No file selected"}
              </span>

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <div style={{ fontSize: 12, color: "#64748b" }}>
              Filenames are auto-generated. Providers never type names.
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

/* ========================= Manage Patients View + Modals ========================= */

function ManagePatientsPage({ rows, reload }: { rows: PatientRow[]; reload: () => Promise<void> }) {
  const [sortMode, setSortMode] = useState<SortMode>("ALPHABETICAL");
  const [query, setQuery] = useState("");
  const [editTarget, setEditTarget] = useState<PatientRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PatientRow | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((p) => !q || p.secret_id.toLowerCase().includes(q));

    return [...list].sort((a, b) => {
      if (sortMode === "ALPHABETICAL") return a.secret_id.localeCompare(b.secret_id);

      const rank = (s: "Critical" | "Warning" | "Normal") => (s === "Critical" ? 0 : s === "Warning" ? 1 : 2);
      const ra = rank(statusFromPatient(a));
      const rb = rank(statusFromPatient(b));
      if (ra !== rb) return ra - rb;
      return a.secret_id.localeCompare(b.secret_id);
    });
  }, [rows, query, sortMode]);

  return (
    <div
      style={{
        minHeight: "calc(100vh - 72px)",
        background: PRIMARY,
        padding: 18,
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.18)",
          boxShadow: "0 14px 30px rgba(16,24,40,0.22)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 16, borderBottom: "1px solid #e6ebf2" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 900, fontSize: 16 }}>Your Patients</div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className={"chip" + (sortMode === "PRIORITY" ? " active" : "")}
                onClick={() => setSortMode("PRIORITY")}
                style={{ minWidth: 110 }}
              >
                Priority + Issues
              </button>
              <button
                type="button"
                className={"chip" + (sortMode === "ALPHABETICAL" ? " active" : "")}
                onClick={() => setSortMode("ALPHABETICAL")}
                style={{ minWidth: 110 }}
              >
                A–Z
              </button>
            </div>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
            <div style={{ flex: 1, position: "relative" }}>
              <input
                className="searchInput"
                placeholder="Search patients..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <button className="chip" type="button" onClick={reload}>
              Refresh
            </button>
          </div>
        </div>

        <div style={{ padding: 12 }}>
          <div style={{ display: "grid", gap: 10 }}>
            {filtered.map((p) => {
              const status = statusFromPatient(p);
              return (
                <div
                  key={p.id}
                  style={{
                    border: "1px solid rgba(15, 23, 42, 0.10)",
                    borderRadius: 16,
                    padding: 14,
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ fontWeight: 900, fontSize: 16 }}>{p.secret_id}</div>
                      <StatusDot status={status} />
                      <div style={{ color: "#64748b", fontSize: 13 }}>Last sync: {formatLastSync(p)}</div>
                    </div>

                    <div style={{ display: "flex", gap: 18, flexWrap: "wrap", color: "#334155", fontSize: 13 }}>
                      <span>
                        <strong>Dispensed:</strong> {new Date(p.brace_dispensed_at).toLocaleDateString()}
                      </span>
                      <span>
                        <strong>Days since dispensed:</strong> {daysSince(p.brace_dispensed_at)}
                      </span>
                      <span>
                        <strong>Compliant days:</strong> {p.days_fully_compliant}
                      </span>
                      <span>
                        <strong>Streak:</strong> {p.streak_days}
                      </span>
                      <span>
                        <strong>Total hours:</strong> {formatHours(p.total_hours_worn)} hrs
                      </span>
                      <span>
                        <strong>Goal:</strong> {p.compliance_goal ?? 16} hrs/day
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => setEditTarget(p)}
                      title="Edit patient"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        border: "1px solid rgba(15, 23, 42, 0.12)",
                      }}
                    >
                      <IconEdit />
                      Edit
                    </button>

                    <button
                      type="button"
                      className="chip"
                      onClick={() => setDeleteTarget(p)}
                      title="Delete patient"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        border: "1px solid rgba(229,83,61,0.35)",
                        color: "#E5533D",
                        background: "rgba(229,83,61,0.06)",
                      }}
                    >
                      <IconTrash />
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}

            {filtered.length === 0 && <div style={{ padding: 18, color: "#64748b" }}>No patients found.</div>}
          </div>
        </div>
      </div>

      {editTarget && (
        <EditPatientModal
          patient={editTarget}
          onClose={() => setEditTarget(null)}
          onDelete={() => {
            setDeleteTarget(editTarget);
            setEditTarget(null);
          }}
          onSaved={async () => {
            setEditTarget(null);
            await reload();
          }}
        />
      )}

      {deleteTarget && (
        <DeletePatientModal
          patient={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={async () => {
            setDeleteTarget(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}

function ManageFab({ onCreated }: { onCreated: () => Promise<void> }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Add patient"
        title="Add patient"
        style={{
          position: "fixed",
          right: 22,
          bottom: 22,
          width: 56,
          height: 56,
          borderRadius: 999,
          border: "none",
          background: PRIMARY,
          color: "#fff",
          display: "grid",
          placeItems: "center",
          boxShadow: "0 14px 30px rgba(16,24,40,0.18)",
          cursor: "pointer",
          zIndex: 60,
        }}
      >
        <IconPlus />
      </button>

      {open && (
        <CreatePatientModal
          onClose={() => setOpen(false)}
          onCreated={async () => {
            setOpen(false);
            await onCreated();
          }}
        />
      )}
    </>
  );
}

/* ========================= Create / Edit / Delete Modals ========================= */

function ModalShell({
  title,
  children,
  onClose,
  footer,
  width = 560,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  width?: number;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
        padding: 18,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: `min(${width}px, 100%)`,
          background: "#fff",
          borderRadius: 18,
          border: "1px solid rgba(15, 23, 42, 0.10)",
          boxShadow: "0 18px 50px rgba(15, 23, 42, 0.25)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 16, borderBottom: "1px solid #e6ebf2", display: "flex", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 900 }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 36,
              height: 36,
              border: "none",
              background: "transparent",
              color: "#64748b",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              padding: 0,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div style={{ padding: 16 }}>{children}</div>

        {footer ? (
          <div style={{ padding: 16, borderTop: "1px solid #e6ebf2", display: "flex", justifyContent: "flex-end", gap: 10 }}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// NOTE: the Create/Edit/Delete modals below are unchanged from your version.
function CreatePatientModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [secretId, setSecretId] = useState("");
  const [password, setPassword] = useState("");
  const [goal, setGoal] = useState<number>(16);
  const [dispensedAt, setDispensedAt] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setErr(null);
    setSaving(true);

    try {
      if (!secretId.trim()) throw new Error("Secret ID is required.");
      if (!password.trim()) throw new Error("Password is required.");
      if (password.trim().length < 8) throw new Error("Password must be at least 8 characters.");

      const internalEmail = `${secretId.trim()}@bracetracker.com`;
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) throw new Error("You are not logged in. Please log in again.");

      const payload = {
        secret_id: secretId.trim(),
        patient_email: internalEmail,
        password_mode: "manual" as const,
        password: password,
        brace_dispensed_at: new Date(dispensedAt).toISOString(),
        compliance_goal: goal,
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
      const patientId = (data as any)?.patient?.id as string | undefined;
      if (patientId) {
        const { error: historyError } = await supabase.from("patient_goal_history").insert({
          patient_id: patientId,
          goal,
          effective_at: new Date(dispensedAt).toISOString(),
        });

        if (historyError && !historyError.message.toLowerCase().includes("patient_goal_history")) {
          throw new Error(historyError.message);
        }
      }

      await onCreated();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to create patient.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title="Add Patient"
      onClose={onClose}
      footer={
        <>
          <button className="chip" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="primaryBtn" type="button" onClick={create} disabled={saving} style={{ background: PRIMARY }}>
            {saving ? "Creating…" : "Create Patient"}
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Secret ID</div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 430px) auto", gap: 10, alignItems: "center" }}>
            <input className="searchInput" value={secretId} onChange={(e) => setSecretId(e.target.value)} placeholder="PC-0001" />
            <button
              type="button"
              className="chip"
              onClick={() => setSecretId(suggestSecretId())}
              disabled={saving}
              style={{ border: "1px solid rgba(210,45,45,0.25)", color: PRIMARY, background: "rgba(210,45,45,0.06)", whiteSpace: "nowrap" }}
            >
              Suggest ID
            </button>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Password</div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 430px) auto", gap: 10, alignItems: "center" }}>
            <input className="searchInput" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Panda3!" />
            <button
              type="button"
              className="chip"
              onClick={() => setPassword(suggestPassword())}
              disabled={saving}
              style={{ border: "1px solid rgba(210,45,45,0.25)", color: PRIMARY, background: "rgba(210,45,45,0.06)", whiteSpace: "nowrap" }}
            >
              Suggest password
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>Click “Suggest password” again to generate a new one.</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Compliance goal (hrs/day)</div>
            <input className="searchInput" type="number" min={1} max={24} value={goal} onChange={(e) => setGoal(Number(e.target.value))} />
          </div>

          <div>
            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Brace dispensed date</div>
            <input className="searchInput" type="date" value={dispensedAt} onChange={(e) => setDispensedAt(e.target.value)} />
          </div>
        </div>

        {err && <div style={{ color: "#E5533D", fontSize: 13 }}>{err}</div>}
      </div>
    </ModalShell>
  );
}

function EditPatientModal({
  patient,
  onClose,
  onDelete,
  onSaved,
}: {
  patient: PatientRow;
  onClose: () => void;
  onDelete: () => void;
  onSaved: () => Promise<void>;
}) {
  const [secretId, setSecretId] = useState(patient.secret_id);
  const [goal, setGoal] = useState<number>(patient.compliance_goal ?? 16);
  const [dispensedAt, setDispensedAt] = useState<string>(() => new Date(patient.brace_dispensed_at).toISOString().slice(0, 10));
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setSaving(true);

    try {
      const { error: updErr } = await supabase
        .from("patients")
        .update({
          secret_id: secretId.trim(),
          brace_dispensed_at: new Date(dispensedAt).toISOString(),
          compliance_goal: goal,
        })
        .eq("id", patient.id);

      if (updErr) throw new Error(updErr.message);

      if (newPassword.trim()) {
        const { error: pwErr } = await supabase.functions.invoke("update-patient", {
          body: {
            patient_id: patient.id,
            action: "update_password",
            new_password: newPassword.trim(),
          },
        });
        if (pwErr) throw new Error(`Saved profile, but password update failed: ${pwErr.message}`);
      }

      await onSaved();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title={`Edit ${patient.secret_id}`}
      onClose={onClose}
      footer={
        <>
          <button
            className="chip"
            type="button"
            onClick={onDelete}
            disabled={saving}
            style={{ border: "1px solid rgba(229,83,61,0.35)", color: "#E5533D", background: "rgba(229,83,61,0.06)" }}
          >
            Delete
          </button>
          <button className="chip" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="primaryBtn" type="button" onClick={save} disabled={saving} style={{ background: PRIMARY }}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Secret ID</div>
          <input className="searchInput" value={secretId} onChange={(e) => setSecretId(e.target.value)} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Compliance goal (hrs/day)</div>
            <input className="searchInput" type="number" min={1} max={24} value={goal} onChange={(e) => setGoal(Number(e.target.value))} />
          </div>

          <div>
            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, marginBottom: 6 }}>Brace dispensed date</div>
            <input className="searchInput" type="date" value={dispensedAt} onChange={(e) => setDispensedAt(e.target.value)} />
          </div>
        </div>

        <div style={{ borderTop: "1px solid #e6ebf2", paddingTop: 12, marginTop: 6 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Password</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input className="searchInput" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Leave blank to keep current" style={{ flex: 1 }} />
            <button
              type="button"
              className="chip"
              onClick={() => setNewPassword(suggestPassword())}
              disabled={saving}
              style={{
                border: "1px solid rgba(210,45,45,0.25)",
                color: PRIMARY,
                background: "rgba(210,45,45,0.06)",
                whiteSpace: "nowrap",
              }}
            >
              Suggest
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
            Still developing.
          </div>
        </div>

        {err && <div style={{ color: "#E5533D", fontSize: 13 }}>{err}</div>}
      </div>
    </ModalShell>
  );
}

function DeletePatientModal({ patient, onClose, onDeleted }: { patient: PatientRow; onClose: () => void; onDeleted: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function del() {
    setErr(null);
    setSaving(true);

    try {
      const { error } = await supabase.functions.invoke("delete-patient", {
        body: { patient_id: patient.id },
      });

      if (error) throw new Error(error.message);

      await onDeleted();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to delete patient.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title={`Delete ${patient.secret_id}?`}
      onClose={onClose}
      footer={
        <>
          <button className="chip" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="primaryBtn" type="button" onClick={del} disabled={saving} style={{ background: "#E5533D" }}>
            {saving ? "Deleting…" : "Delete"}
          </button>
        </>
      }
      width={520}
    >
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ color: "#0f172a" }}>
          This will remove the patient from your workspace and may delete wear history depending on your backend delete rules.
        </div>
        {err && <div style={{ color: "#E5533D", fontSize: 13 }}>{err}</div>}
      </div>
    </ModalShell>
  );
}

/* ========================= UI bits ========================= */

function FilterPill({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" className={"pill" + (active ? " active" : "")} onClick={onClick}>
      {children}
    </button>
  );
}

function StatusDot({ status }: { status: "Critical" | "Warning" | "Normal" }) {
  return <span className={"statusDot " + status.toLowerCase()} title={status} />;
}

// Compact, square-ish stat tile
function MiniMetricCard({ title, value, sub }: { title: string; value: number | string; sub: string }) {
  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid rgba(15, 23, 42, 0.10)",
        background: "#fff",
        padding: 12,
        minHeight: 92,
        display: "grid",
        alignContent: "space-between",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>{title}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontSize: 28, fontWeight: 950, lineHeight: 1, color: "#0f172a" }}>{value}</div>
        <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>{sub}</div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      <div className="legendItem">
        <span className="statusDot normal" /> Normal
      </div>
      <div className="legendItem">
        <span className="statusDot warning" /> Warning
      </div>
      <div className="legendItem">
        <span className="statusDot critical" /> Critical
      </div>
    </div>
  );
}

void agoLabel;
void ManagePatientsPage;
void ManageFab;
void FilterPill;
void Legend;

