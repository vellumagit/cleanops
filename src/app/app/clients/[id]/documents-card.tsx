"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, FileText, Download, Trash2, Loader2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
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

const IMAGE_NAME = /\.(jpe?g|png|webp|gif)$/i;

/**
 * What the file is, at a glance: the picture itself for a photo, a labelled
 * page for a PDF. A photo the browser can't draw (HEIC from an iPhone) falls
 * back to the labelled page rather than a broken-image mark.
 */
function Preview({ doc }: { doc: ClientDocument }) {
  const [broken, setBroken] = useState(false);
  const isImage = IMAGE_NAME.test(doc.file_name) && doc.url && !broken;
  const ext = (doc.file_name.split(".").pop() ?? "file").slice(0, 4).toUpperCase();
  return (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-muted/40">
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={doc.url ?? undefined}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex flex-col items-center gap-1 text-muted-foreground">
          <FileText className="h-6 w-6" />
          <span className="text-[10px] font-semibold tracking-wide">{ext}</span>
        </div>
      )}
    </div>
  );
}

export function ClientDocumentsCard({
  clientId,
  documents,
  canEdit,
  tz,
}: {
  clientId: string;
  documents: ClientDocument[];
  canEdit: boolean;
  /** The company's zone: an upload's date is the office's date, not the viewer's. */
  tz: string;
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
      {/* One section per kind, stacked, one row per file. The three kinds
          used to sit side by side in narrow columns, which cut every file
          name short and hid Download until the row was hovered. Rows, not a
          grid of tiles: this card lives in a half-width column of the client
          page, where tiles came out 70px wide. */}
      <div className="divide-y divide-border">
        {CLIENT_DOCUMENT_CATEGORIES.map((cat) => {
          const docs = documents.filter((d) => d.category === cat.key);
          return (
            <div key={cat.key} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    {cat.label}
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
                      {docs.length}
                    </span>
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{cat.hint}</p>
                </div>
                {canEdit && (
                  <>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => inputs.current[cat.key]?.click()}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      {pending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      Add file
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

              {docs.length === 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">No files yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {docs.map((d) => (
                    <li
                      key={d.id}
                      className="flex min-w-0 items-start gap-3 rounded-lg border border-border/70 p-2.5"
                    >
                      {d.url ? (
                        <a
                          href={d.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open ${d.label}`}
                          className="block shrink-0 rounded-md transition-opacity hover:opacity-90"
                        >
                          <Preview doc={d} />
                        </a>
                      ) : (
                        <Preview doc={d} />
                      )}
                      <div className="min-w-0 flex-1">
                        {/* The whole name, wrapped, never cut. */}
                        <p className="text-sm font-medium leading-snug [overflow-wrap:anywhere]">
                          {d.label}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {formatDate(d.created_at, tz)}
                          {d.size_bytes ? ` · ${formatSize(d.size_bytes)}` : ""}
                        </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {d.url && (
                          <>
                            <a
                              href={d.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              Open
                            </a>
                            <a
                              href={d.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              download={d.file_name}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
                            >
                              <Download className="h-3.5 w-3.5" />
                              Download
                            </a>
                          </>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => {
                              if (window.confirm(`Delete "${d.label}"? This can't be undone.`)) remove(d.id, d.label);
                            }}
                            className={cn(
                              "ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
                              "disabled:opacity-50",
                            )}
                            aria-label={`Delete ${d.label}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        )}
                      </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
