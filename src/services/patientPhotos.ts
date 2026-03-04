import { supabase } from "../supabaseClient";

export type PhotoType = "Front" | "Side" | "Other" | "Progress";

export type PatientPhotoRow = {
  id: string;
  patient_id: string;
  storage_path: string;
  captured_at: string; // timestamptz
  uploaded_by_auth_user_id: string | null;
  note: string | null;
  created_at: string;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function formatDateLabel(iso: string) {
  // "Feb 11, 2026"
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function isoDateOnlyUTC(d: Date) {
  // yyyy-mm-dd in UTC
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function safeSlug(s: string) {
  return s.trim().toLowerCase().replace(/[^\w\-]+/g, "-").replace(/\-+/g, "-").replace(/^\-|\-$/g, "");
}

export async function listPatientPhotos(patientId: string, limit = 48) {
  const { data, error } = await supabase
    .from("patient_photos")
    .select("id, patient_id, storage_path, captured_at, uploaded_by_auth_user_id, note, created_at")
    .eq("patient_id", patientId)
    .order("captured_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as PatientPhotoRow[];
}

export async function signPhotoUrls(storagePaths: string[], expiresSeconds = 60 * 60) {
  const bucket = supabase.storage.from("patient_photos");

  const out: Record<string, string> = {};
  for (const path of storagePaths) {
    const { data, error } = await bucket.createSignedUrl(path, expiresSeconds);
    if (!error && data?.signedUrl) out[path] = data.signedUrl;
  }
  return out;
}

export async function uploadPatientPhoto(args: {
  patientId: string;
  file: File;
  photoType: PhotoType;
  capturedDate: Date; // user-selected date; time will be "now" but date drives label/path
  note?: string;
}) {
  const { patientId, file, photoType, capturedDate, note } = args;

  // Build captured_at as "captured date" + current time (UTC) so ordering is stable
  const now = new Date();
  const capturedAt = new Date(Date.UTC(
    capturedDate.getUTCFullYear(),
    capturedDate.getUTCMonth(),
    capturedDate.getUTCDate(),
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds()
  ));

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const datePart = isoDateOnlyUTC(capturedAt);
  const typePart = safeSlug(photoType); // front/side/other/progress
  const uniq = crypto.randomUUID();

  // ✅ storage_path stored in DB should match exactly what we upload
  const storagePath = `${patientId}/${datePart}_${typePart}_${uniq}.${ext}`;

  // 1) Upload file to storage
  const bucket = supabase.storage.from("patient_photos");
  const { error: uploadErr } = await bucket.upload(storagePath, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "image/jpeg",
  });

  if (uploadErr) throw new Error(uploadErr.message);

  // 2) Insert row into patient_photos
  const { data: userData } = await supabase.auth.getUser();
  const uploaderId = userData.user?.id ?? null;

  const { error: insertErr } = await supabase
    .from("patient_photos")
    .insert({
      patient_id: patientId,
      storage_path: storagePath,
      captured_at: capturedAt.toISOString(),
      uploaded_by_auth_user_id: uploaderId,
      note: note ?? null,
    });

  if (insertErr) throw new Error(insertErr.message);

  return { storagePath, capturedAt: capturedAt.toISOString() };
}
