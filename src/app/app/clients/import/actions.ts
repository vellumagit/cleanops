"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";

export type ImportResult =
  | { ok: true; created: number; skipped: number; errors: string[] }
  | { ok: false; error: string };

type ParsedRow = {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  preferred_contact: "email" | "phone" | "sms" | null;
  notes: string | null;
};

/**
 * Minimal RFC 4180-ish CSV parser — handles quoted fields and embedded
 * commas/newlines. Good enough for human-authored CSVs. Doesn't handle
 * exotic edge cases (CR-only line endings, mismatched quotes) gracefully
 * — we fail loud if the input is malformed.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          // Escaped quote
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      // Handle \r\n
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 0 && (row.length > 1 || row[0] !== "")) {
        rows.push(row);
      }
      row = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  // Final field + row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }

  return rows;
}

function normalizeHeader(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

export async function importClientsAction(
  formData: FormData,
): Promise<ImportResult> {
  const { membership, supabase } = await getActionContext();

  if (!["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "Only owners and admins can import clients." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Upload a CSV file first." };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { ok: false, error: "File too large (max 5 MB)." };
  }

  const text = await file.text();
  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch {
    return { ok: false, error: "Could not parse the CSV. Check for malformed quotes." };
  }

  if (rows.length < 2) {
    return { ok: false, error: "CSV needs a header row and at least one data row." };
  }

  // Map header row to known columns
  const headers = rows[0].map(normalizeHeader);
  const colIndex = (aliases: string[]): number => {
    for (const a of aliases) {
      const idx = headers.indexOf(a);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const idx = {
    name: colIndex(["name", "full_name", "client", "client_name"]),
    email: colIndex(["email", "email_address", "e_mail"]),
    phone: colIndex(["phone", "phone_number", "mobile", "cell"]),
    address: colIndex(["address", "street", "location"]),
    preferred_contact: colIndex(["preferred_contact", "contact_method", "contact"]),
    notes: colIndex(["notes", "note", "comment", "comments"]),
  };

  if (idx.name === -1) {
    return {
      ok: false,
      error: "No 'name' column found. Required columns: name. Optional: email, phone, address, preferred_contact, notes.",
    };
  }

  // Parse data rows
  const parsed: ParsedRow[] = [];
  const errors: string[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[idx.name] ?? "").trim();
    if (!name) {
      errors.push(`Row ${r + 1}: skipped — missing name`);
      continue;
    }

    const emailRaw = idx.email >= 0 ? (row[idx.email] ?? "").trim() : "";
    const email = emailRaw || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(`Row ${r + 1}: skipped — invalid email "${email}"`);
      continue;
    }

    const preferredRaw =
      idx.preferred_contact >= 0
        ? (row[idx.preferred_contact] ?? "").trim().toLowerCase()
        : "";
    let preferred_contact: ParsedRow["preferred_contact"] = null;
    if (preferredRaw) {
      if (["email", "phone", "sms"].includes(preferredRaw)) {
        preferred_contact = preferredRaw as "email" | "phone" | "sms";
      } else {
        errors.push(
          `Row ${r + 1}: preferred_contact "${preferredRaw}" not recognized (use email/phone/sms); left blank`,
        );
      }
    }

    parsed.push({
      name,
      email,
      phone: idx.phone >= 0 ? (row[idx.phone] ?? "").trim() || null : null,
      address: idx.address >= 0 ? (row[idx.address] ?? "").trim() || null : null,
      preferred_contact,
      notes: idx.notes >= 0 ? (row[idx.notes] ?? "").trim() || null : null,
    });
  }

  if (parsed.length === 0) {
    return {
      ok: false,
      error: `No valid rows found. ${errors.slice(0, 5).join("; ")}`,
    };
  }

  // Dedupe against existing clients by name + (email or phone)
  const { data: existing } = await supabase
    .from("clients")
    .select("name, email, phone")
    .limit(5000);

  const existingKeys = new Set(
    (existing ?? []).map((c) =>
      `${c.name?.toLowerCase()}|${c.email?.toLowerCase() ?? ""}|${c.phone ?? ""}`,
    ),
  );

  const toInsert = parsed.filter((p) => {
    const key = `${p.name.toLowerCase()}|${p.email?.toLowerCase() ?? ""}|${p.phone ?? ""}`;
    return !existingKeys.has(key);
  });

  const skippedDuplicates = parsed.length - toInsert.length;

  if (toInsert.length === 0) {
    return {
      ok: true,
      created: 0,
      skipped: skippedDuplicates,
      errors,
    };
  }

  const { error: insertErr } = await supabase.from("clients").insert(
    toInsert.map((p) => ({
      organization_id: membership.organization_id,
      ...p,
    })) as never,
  );

  if (insertErr) return { ok: false, error: insertErr.message };

  await logAuditEvent({
    membership,
    action: "create",
    entity: "client",
    after: { imported: toInsert.length, skipped_duplicates: skippedDuplicates },
  });

  revalidatePath("/app/clients");
  return {
    ok: true,
    created: toInsert.length,
    skipped: skippedDuplicates,
    errors,
  };
}
