// supabase/functions/r2-presign/index.ts
//
// Presigns short-lived R2 (S3-compatible) URLs for upload/read, and performs
// server-side delete for upload-rollback. Mirrors the security posture of the
// existing Supabase Storage path in src/services/imaging.ts:
//   - the caller must be authenticated
//   - the caller must be able to see the patient the path belongs to (RLS-scoped)
//   - storage_path shape is re-validated here (p/<patient>/<study>/<file>)
//   - URLs are short-lived; nothing is ever made public
//
// Secrets required (already set on iapp-production):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
//   ALLOWED_ORIGINS (already used by the AI-analysis function)
//
// ASSUMPTION TO CONFIRM: the patient-scope check below queries
// iapp.patients with the caller's own JWT, relying on existing RLS to
// reject patients the caller cannot see. If patients aren't readable
// directly (e.g. access is only granted through a view or join), tell
// Claude and this check gets swapped for the right table/view.

import { createClient } from "npm:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

const ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID")!;
const ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID")!;
const SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY")!;
const BUCKET = Deno.env.get("R2_BUCKET_NAME")!;
const ENDPOINT = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const aws = new AwsClient({
  accessKeyId: ACCESS_KEY_ID,
  secretAccessKey: SECRET_ACCESS_KEY,
  service: "s3",
  region: "auto",
});

// Must mirror the DB constraint chk_img_path_shape: p/<patient>/<study>/<file>
const PATH_RE = /^p\/([0-9a-fA-F-]{36})\/([0-9a-fA-F-]{36})\/[a-z0-9_.-]+$/;

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : (ALLOWED_ORIGINS[0] ?? "*");
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

Deno.serve(async (req) => {
  const headers = { ...corsHeaders(req.headers.get("origin")), "Content-Type": "application/json" };

  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "missing auth" }), { status: 401, headers });
  }

  // Scoped to the caller's own JWT so the existing RLS policies apply exactly
  // as they do everywhere else in the app -- this function has no special
  // elevated access of its own.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  }

  let body: { action?: string; path?: string; contentType?: string; ttl?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), { status: 400, headers });
  }

  const { action, path, contentType } = body;
  const ttl = Math.min(Math.max(body.ttl ?? 300, 60), 900);

  if (!action || !path || !PATH_RE.test(path)) {
    return new Response(JSON.stringify({ error: "invalid path or action" }), { status: 400, headers });
  }

  const patientId = path.split("/")[1];

  // Patient-scope check -- see ASSUMPTION note at top of file.
  const { data: patientRow, error: patientErr } = await supabase
    .schema("iapp")
    .from("patients")
    .select("id")
    .eq("id", patientId)
    .maybeSingle();

  if (patientErr || !patientRow) {
    return new Response(JSON.stringify({ error: "not found or not authorized" }), { status: 403, headers });
  }

  const objectUrl = `${ENDPOINT}/${BUCKET}/${path}`;

  try {
    if (action === "upload") {
      const signed = await aws.sign(
        new Request(`${objectUrl}?X-Amz-Expires=${ttl}`, {
          method: "PUT",
          headers: contentType ? { "content-type": contentType } : {},
        }),
        { aws: { signQuery: true } },
      );
      return new Response(JSON.stringify({ url: signed.url }), { headers });
    }

    if (action === "read") {
      const signed = await aws.sign(
        new Request(`${objectUrl}?X-Amz-Expires=${ttl}`, { method: "GET" }),
        { aws: { signQuery: true } },
      );
      return new Response(JSON.stringify({ url: signed.url }), { headers });
    }

    if (action === "delete") {
      const res = await aws.fetch(objectUrl, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        return new Response(JSON.stringify({ error: `r2 delete failed: ${res.status}` }), { status: 502, headers });
      }
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), { status: 400, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers });
  }
});
