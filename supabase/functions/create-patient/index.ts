


import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Body = {
  secret_id: string;
  patient_email: string;
  password_mode: "manual" | "random";
  password?: string;
  brace_dispensed_at?: string; // ISO string
  compliance_goal?: number; // hrs/day
};

const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
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

function randomPassword(len = 14) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  let out = "";
  crypto.getRandomValues(new Uint32Array(len)).forEach((n) => {
    out += chars[n % chars.length];
  });
  return out;
}

serve(async (req: Request) => {

  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json(405, { error: "Method not allowed" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRole);

    // Verify provider is logged in (JWT already verified by Supabase gateway)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing Authorization header" });

    const callerJwt = authHeader.replace("Bearer ", "").trim();
    if (!callerJwt) return json(401, { error: "Missing bearer token" });

    const providerId = decodeJwtSub(callerJwt);
    if (!providerId) return json(401, { error: "Unauthorized" });

    const body = (await req.json()) as Body;
    const secret_id = body.secret_id?.trim();
    const patient_email = body.patient_email?.trim().toLowerCase();
    if (!secret_id || !patient_email) {
      return json(400, { error: "secret_id and patient_email are required" });
    }

    let password = body.password_mode === "manual" ? (body.password ?? "") : randomPassword(14);
    if (body.password_mode === "manual") {
      if (password.length < 8) return json(400, { error: "Password must be at least 8 characters" });
    }

    // Ensure provider exists (optional: auto-create)
    await supabase.from("providers").upsert({ id: providerId });

    // 1) Create Auth user for patient
    const { data: newUser, error: createUserErr } = await supabase.auth.admin.createUser({
      email: patient_email,
      password,
      email_confirm: true,
    });
    if (createUserErr) return json(400, { error: createUserErr.message });

    // 2) Create patients row
    const { data: patientRows, error: patientErr } = await supabase
      .from("patients")
      .insert([
        {
          auth_user_id: newUser.user.id,
          secret_id,
          brace_dispensed_at: body.brace_dispensed_at ?? undefined,
          compliance_goal: body.compliance_goal ?? undefined,
        },
      ])
      .select("id, secret_id, brace_dispensed_at, compliance_goal")
      .single();

    if (patientErr) return json(400, { error: patientErr.message });

    // 3) Assign patient to provider
    const { error: assignErr } = await supabase
      .from("provider_patients")
      .insert([{ provider_id: providerId, patient_id: patientRows.id }]);

    if (assignErr) return json(400, { error: assignErr.message });

    return json(200, {
      patient: patientRows,
      generated_password: body.password_mode === "random" ? password : null,
    });
  } catch (e) {
    return json(500, { error: String(e) });
  }
});
