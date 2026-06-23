"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, FileText, Download, Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DOCUMENT_CATEGORIES } from "./document-categories";
import {
  uploadEmployeeDocumentAction,
  deleteEmployeeDocumentAction,
} from "./document-actions";

export type EmployeeDocument = {
  id: string;
  category: string;
  label: string;
  file_name: string;
  size_bytes: number | null;
  created_at: string;
  /** Short-lived signed download URL generated on the server. */
  url: string | null;
};

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function DocumentsPanel({
  membershipId,
  documents,
}: {
  membershipId: string;
  documents: EmployeeDocument[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  function upload(category: string, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("category", category);
    fd.append("label", file.name);
    startTransition(async () => {
      const res = await uploadEmployeeDocumentAction(membershipId, fd);
      if (res.ok) {
        toast.success(`Uploaded ${file.name}`);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function remove(id: string, label: string) {
    startTransition(async () => {
      const res = await deleteEmployeeDocumentAction(id);
      if (res.ok) {
        toast.success(`Deleted ${label}`);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {DOCUMENT_CATEGORIES.map((cat) => {
        const docs = documents.filter((d) => d.category === cat.key);
        return (
          <section
            key={cat.key}
            className="flex flex-col rounded-xl border border-border bg-card"
          >
            <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  {cat.label}
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
                    {docs.length}
                  </span>
                </h3>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {cat.hint}
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => inputs.current[cat.key]?.click()}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                Add
              </button>
              <input
                ref={(el) => {
                  inputs.current[cat.key] = el;
                }}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(cat.key, f);
                  e.target.value = "";
                }}
              />
            </header>

            <div className="flex-1 p-2">
              {docs.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  No documents yet
                </p>
              ) : (
                <ul className="space-y-1">
                  {docs.map((d) => (
                    <li
                      key={d.id}
                      className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{d.label}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDate(d.created_at)}
                          {d.size_bytes ? ` · ${formatSize(d.size_bytes)}` : ""}
                        </p>
                      </div>
                      {d.url && (
                        <a
                          href={d.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          download={d.file_name}
                          className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                          aria-label={`Download ${d.label}`}
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      )}
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => remove(d.id, d.label)}
                        className={cn(
                          "rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100",
                          "disabled:opacity-50",
                        )}
                        aria-label={`Delete ${d.label}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
