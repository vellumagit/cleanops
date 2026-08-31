"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, FileText, Download, Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CLIENT_DOCUMENT_CATEGORIES } from "./document-categories";
import {
  uploadClientDocumentAction,
  deleteClientDocumentAction,
} from "./document-actions";

export type ClientDocument = {
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

export function ClientDocumentsCard({
  clientId,
  documents,
  canEdit,
}: {
  clientId: string;
  documents: ClientDocument[];
  canEdit: boolean;
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
      // Transport-level failures (body too large, network drop) reject the
      // action promise itself; un-caught inside a transition that becomes
      // the page's error boundary, not a message.
      try {
        const res = await uploadClientDocumentAction(clientId, fd);
        if (res.ok) {
          toast.success(`Uploaded ${file.name}`);
          router.refresh();
        } else {
          toast.error(res.error);
        }
      } catch {
        toast.error("Upload failed — check the file is under 20 MB and try again.");
      }
    });
  }

  function remove(id: string, label: string) {
    startTransition(async () => {
      try {
        const res = await deleteClientDocumentAction(id);
        if (res.ok) {
          toast.success(`Deleted ${label}`);
          router.refresh();
        } else {
          toast.error(res.error);
        }
      } catch {
        toast.error("Delete failed — try again.");
      }
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold">Documents</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Signed invoices and paperwork attached to this client. PDFs and
          images, up to 20 MB.
        </p>
      </header>
      <div className="grid gap-4 p-4 md:grid-cols-3">
        {CLIENT_DOCUMENT_CATEGORIES.map((cat) => {
          const docs = documents.filter((d) => d.category === cat.key);
          return (
            <div
              key={cat.key}
              className="flex flex-col rounded-lg border border-border/70"
            >
              <div className="flex items-start justify-between gap-2 border-b border-border/70 px-3 py-2.5">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-2 text-xs font-semibold">
                    {cat.label}
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
                      {docs.length}
                    </span>
                  </h3>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {cat.hint}
                  </p>
                </div>
                {canEdit && (
                  <>
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
                      accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) upload(cat.key, f);
                        e.target.value = "";
                      }}
                    />
                  </>
                )}
              </div>

              <div className="flex-1 p-1.5">
                {docs.length === 0 ? (
                  <p className="px-2 py-4 text-center text-xs text-muted-foreground">
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
                          <p className="truncate text-sm font-medium">
                            {d.label}
                          </p>
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
                        {canEdit && (
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
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
