"use client";

import { useTransition } from "react";
import { File, FileText, Image, Loader2, Table, Trash2 } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
  deleteContractDocumentAction,
  uploadContractDocumentAction,
} from "./document-actions";

type Doc = {
  id: string;
  name: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
  download_url: string; // signed URL, expires in 1 hour
};

type Props = {
  contractId: string;
  docs: Doc[];
  canEdit: boolean;
};

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocIcon({ mimeType }: { mimeType: string | null }) {
  if (!mimeType) return <File className="h-4 w-4 shrink-0 text-muted-foreground" />;
  if (
    mimeType === "application/pdf" ||
    mimeType === "application/msword" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />;
  }
  if (
    mimeType === "application/vnd.ms-excel" ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return <Table className="h-4 w-4 shrink-0 text-muted-foreground" />;
  }
  if (mimeType.startsWith("image/")) {
    return <Image className="h-4 w-4 shrink-0 text-muted-foreground" />;
  }
  return <File className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

function DeleteDocButton({
  doc,
  contractId,
}: {
  doc: Doc;
  contractId: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 text-muted-foreground hover:text-destructive"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const fd = new FormData();
          fd.set("id", doc.id);
          fd.set("contract_id", contractId);
          await deleteContractDocumentAction(fd);
        });
      }}
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Trash2 className="h-3.5 w-3.5" />
      )}
      <span className="sr-only">Delete {doc.name}</span>
    </Button>
  );
}

export function ContractDocuments({ contractId, docs, canEdit }: Props) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Documents</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {docs.length}
        </span>
      </div>

      {/* Empty state */}
      {docs.length === 0 && canEdit && (
        <p className="text-xs text-muted-foreground">
          No documents yet — upload a contract, SOW, or any related file.
        </p>
      )}

      {/* Document list */}
      {docs.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {docs.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-3 px-3 py-2.5"
            >
              <DocIcon mimeType={doc.mime_type} />
              <div className="min-w-0 flex-1">
                <a
                  href={doc.download_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {doc.name}
                </a>
                <p className="text-xs text-muted-foreground">
                  {[
                    formatBytes(doc.file_size),
                    new Date(doc.created_at).toLocaleDateString(),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {canEdit && (
                <DeleteDocButton doc={doc} contractId={contractId} />
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Upload form */}
      {canEdit && (
        <form action={uploadContractDocumentAction} className="space-y-2">
          <input type="hidden" name="contract_id" value={contractId} />
          <div className="flex items-center gap-2">
            <input
              type="file"
              name="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp"
              className="flex-1 text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground hover:file:bg-accent"
            />
            <SubmitButton
              variant="secondary"
              size="sm"
              pendingLabel="Uploading…"
            >
              Upload
            </SubmitButton>
          </div>
          <p className="text-xs text-muted-foreground">
            PDF, Word, Excel, or image — max 20 MB
          </p>
        </form>
      )}
    </div>
  );
}
