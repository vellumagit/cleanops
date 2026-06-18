/**
 * Generic inbound intake webhook.
 *
 *   POST /api/intake/<form-token>
 *
 * An external form (HTML, Typeform, Jotform, Zapier, etc.) posts JSON or
 * form-urlencoded data here. The token identifies the intake form, whose
 * `type` decides where the submission lands. The FULL payload is always
 * stored as `raw`, so no field is ever lost and new types are easy to add.
 *
 * No auth beyond the unguessable token + IP rate limiting — this is meant to
 * be pasted straight into a form's webhook/action URL.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { rateLimitByIp } from "@/lib/rate-limit-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// This is a public webhook receiver — any tenant's external form (their
// website, Typeform, Zapier…) posts here from the browser, so it must allow
// cross-origin requests. Without these the browser's preflight blocks the
// POST. Headers go on the OPTIONS preflight AND every actual response
// (including 4xx/5xx, or client-side error parsing breaks).
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

/** JSON response with CORS headers attached. */
function corsJson(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** First non-empty value among the candidate keys (case-insensitive). */
function pick(
  body: Record<string, unknown>,
  keys: string[],
): string | null {
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) lower[k.toLowerCase()] = v;
  for (const key of keys) {
    const v = lower[key.toLowerCase()];
    if (v != null && String(v).trim().length > 0) return String(v).trim();
  }
  return null;
}

async function parseBody(req: NextRequest): Promise<Record<string, unknown>> {
  const ctype = req.headers.get("content-type") ?? "";
  try {
    if (ctype.includes("application/json")) {
      const j = await req.json();
      return j && typeof j === "object" ? (j as Record<string, unknown>) : {};
    }
    if (
      ctype.includes("application/x-www-form-urlencoded") ||
      ctype.includes("multipart/form-data")
    ) {
      const form = await req.formData();
      const obj: Record<string, unknown> = {};
      for (const [k, v] of form.entries()) obj[k] = typeof v === "string" ? v : v.name;
      return obj;
    }
    // Last resort: try JSON, then ignore.
    const text = await req.text();
    if (!text) return {};
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {};
    }
  } catch {
    return {};
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = await rateLimitByIp(req, "intake-webhook", 60, 60_000);
  if (limited) {
    for (const [k, v] of Object.entries(CORS_HEADERS)) limited.headers.set(k, v);
    return limited;
  }

  const { token } = await params;
  if (!token) {
    return corsJson({ error: "Missing token" }, 400);
  }

  const admin = createSupabaseAdminClient();

  const { data: form } = (await admin
    .from("intake_forms" as never)
    .select("id, organization_id, type, active")
    .eq("token" as never, token as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      type: string;
      active: boolean;
    } | null;
  };

  // Don't reveal whether the token exists vs is inactive.
  if (!form || !form.active) {
    return corsJson({ error: "Unknown form" }, 404);
  }

  const body = await parseBody(req);

  if (form.type === "job_application") {
    const { error } = (await admin.from("job_applicants" as never).insert({
      organization_id: form.organization_id,
      intake_form_id: form.id,
      name: pick(body, ["name", "full_name", "fullname", "applicant_name"]),
      email: pick(body, ["email", "email_address", "emailaddress", "e-mail"]),
      phone: pick(body, ["phone", "phone_number", "tel", "mobile", "telephone"]),
      position: pick(body, [
        "position",
        "role",
        "job",
        "applying_for",
        "position_applied_for",
        "title",
      ]),
      experience: pick(body, [
        "experience",
        "years_experience",
        "work_experience",
        "yrs_experience",
      ]),
      availability: pick(body, [
        "availability",
        "available",
        "start_date",
        "availability_date",
      ]),
      message: pick(body, [
        "message",
        "cover_letter",
        "about",
        "comments",
        "notes",
      ]),
      resume_url: pick(body, [
        "resume_url",
        "resume",
        "cv_url",
        "cv",
        "portfolio",
        "link",
      ]),
      raw: body,
      status: "new",
    } as never)) as unknown as { error: { message: string } | null };

    if (error) {
      console.error("[intake] job_applicant insert failed:", error.message);
      return corsJson({ error: "Could not save" }, 500);
    }
    return corsJson({ ok: true }, 201);
  }

  // Future types (booking_lead, contact, …) plug in here.
  return corsJson({ error: `Unsupported form type: ${form.type}` }, 422);
}
