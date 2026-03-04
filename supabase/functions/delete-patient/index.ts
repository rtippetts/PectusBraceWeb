import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Body = {
  patient_id: string;
};

const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function decodeJwtSub(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRole =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl) return json(500, { error: "Missing env: SUPABASE_URL" });
    if (!serviceRole) return json(500, { error: "Missing env: SERVICE_ROLE_KEY" });

    const supabase = createClient(supabaseUrl, serviceRole);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing Authorization header" });

    const callerJwt = authHeader.replace("Bearer ", "").trim();
    const providerId = decodeJwtSub(callerJwt);
    if (!providerId) return json(401, { error: "Unauthorized" });

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }

    const patientId = body.patient_id?.trim();
    if (!patientId) return json(400, { error: "patient_id is required" });

    // Ensure caller is linked to this patient.
    const { data: link, error: linkErr } = await supabase
      .from("provider_patients")
      .select("patient_id")
      .eq("provider_id", providerId)
      .eq("patient_id", patientId)
      .maybeSingle();

    if (linkErr) return json(400, { error: linkErr.message });
    if (!link) return json(403, { error: "You are not linked to this patient" });

    // Pull auth id before row deletion.
    const { data: patientRow, error: patientLookupErr } = await supabase
      .from("patients")
      .select("id, auth_user_id")
      .eq("id", patientId)
      .maybeSingle();

    if (patientLookupErr) return json(400, { error: patientLookupErr.message });

    // Always remove provider->patient link for caller.
    const { error: unlinkErr } = await supabase
      .from("provider_patients")
      .delete()
      .eq("provider_id", providerId)
      .eq("patient_id", patientId);

    if (unlinkErr) return json(400, { error: unlinkErr.message });

    // If still linked to other providers, stop at unlink only.
    const { count: remainingLinks, error: remErr } = await supabase
      .from("provider_patients")
      .select("provider_id", { count: "exact", head: true })
      .eq("patient_id", patientId);

    if (remErr) return json(400, { error: remErr.message });
    if ((remainingLinks ?? 0) > 0) {
      return json(200, { ok: true, mode: "unlinked_only", patient_id: patientId });
    }

    // No more provider links -> remove dependent patient records.
    const { data: photoRows, error: photoListErr } = await supabase
      .from("patient_photos")
      .select("storage_path")
      .eq("patient_id", patientId);
    if (photoListErr) return json(400, { error: photoListErr.message });

    const paths = (photoRows ?? [])
      .map((r: any) => r?.storage_path as string | undefined)
      .filter((p): p is string => Boolean(p));

    if (paths.length > 0) {
      const { error: storageErr } = await supabase.storage.from("patient_photos").remove(paths);
      if (storageErr) return json(400, { error: storageErr.message });
    }

    const { error: photoDeleteErr } = await supabase.from("patient_photos").delete().eq("patient_id", patientId);
    if (photoDeleteErr) return json(400, { error: photoDeleteErr.message });

    const { error: wearDeleteErr } = await supabase.from("wear_sessions").delete().eq("patient_id", patientId);
    if (wearDeleteErr) return json(400, { error: wearDeleteErr.message });

    const { error: patientDeleteErr } = await supabase.from("patients").delete().eq("id", patientId);
    if (patientDeleteErr) return json(400, { error: patientDeleteErr.message });

    if (patientRow?.auth_user_id) {
      const { error: authDeleteErr } = await supabase.auth.admin.deleteUser(patientRow.auth_user_id);
      if (authDeleteErr) return json(400, { error: authDeleteErr.message });
    }

    return json(200, { ok: true, mode: "deleted_everywhere", patient_id: patientId });
  } catch (e) {
    return json(500, { error: String(e) });
  }
});

