"use client";

import { Download } from "lucide-react";

export type AuditExportRow = {
  when: string;
  actor: string;
  role: string;
  action: string;
  entity: string;
  entityId: string;
  details: string;
};

const HEADERS = [
  "When",
  "Actor",
  "Role",
  "Action",
  "Entity",
  "Entity ID",
  "Details",
] as const;

function escapeCell(value: string): string {
  // Always quote — the Details column carries JSON with commas/quotes.
  return `"${value.replace(/"/g, '""')}"`;
}

function toCsv(rows: AuditExportRow[]): string {
  const lines = [HEADERS.map(escapeCell).join(",")];
  for (const r of rows) {
    lines.push(
      [r.when, r.actor, r.role, r.action, r.entity, r.entityId, r.details]
        .map((v) => escapeCell(v ?? ""))
        .join(","),
    );
  }
  return lines.join("\r\n");
}

/**
 * Downloads the currently-filtered audit rows as a CSV. Operates on the
 * rows already rendered (server-filtered), so the export matches exactly
 * what the user is looking at.
 */
export function AuditExportButton({
  rows,
  filename,
}: {
  rows: AuditExportRow[];
  filename: string;
}) {
  function download() {
    const csv = toCsv(rows);
    // Prepend a BOM so Excel reads UTF-8 correctly.
    const blob = new Blob(["﻿", csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={rows.length === 0}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
    >
      <Download className="h-3.5 w-3.5" />
      Export CSV
    </button>
  );
}
