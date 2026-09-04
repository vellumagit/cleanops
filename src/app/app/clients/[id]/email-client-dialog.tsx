"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Mail, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SubmitButton } from "@/components/submit-button";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  sendClientEmailAction,
  type ClientEmailFormState,
} from "./email-actions";

export type EmailableDocument = {
  id: string;
  label: string;
  file_name: string;
  size_bytes: number | null;
  category: string;
};

const empty: ClientEmailFormState = {};

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * "Email client" — the compose panel on a client's profile.
 *
 * The recipient is fixed to the address on record (shown, not editable):
 * this is the office writing to its client, not a general mailer. The
 * attachment list is the client's own Documents plus anything picked
 * from the device; new files are kept on the record by default so the
 * sent folder and the Documents card tell the same story.
 */
export function EmailClientDialog({
  clientId,
  clientName,
  clientEmail,
  replyTo,
  documents,
}: {
  clientId: string;
  clientName: string;
  clientEmail: string;
  /** Where replies land, resolved server-side; null when the org has no
   *  contact or sender email and replies would go nowhere. */
  replyTo: string | null;
  documents: EmailableDocument[];
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [state, action] = useActionState(
    sendClientEmailAction.bind(null, clientId),
    empty,
  );

  // Close on success. State is adjusted during render (the React-blessed
  // pattern for "derive from a prop change"), the toast stays an effect.
  const [seenSentAt, setSeenSentAt] = useState<number | undefined>(undefined);
  if (state.sentAt && state.sentAt !== seenSentAt) {
    setSeenSentAt(state.sentAt);
    setOpen(false);
    setPicked([]);
  }
  useEffect(() => {
    if (state.sentAt) toast.success(`Email sent to ${clientName}`);
  }, [state.sentAt, clientName]);

  // React resets the (uncontrolled) file input when the action settles,
  // and Radix unmounts it on close — so the chips must not outlive it.
  const [seenError, setSeenError] = useState<string | undefined>(undefined);
  if (state.error !== seenError) {
    setSeenError(state.error);
    setPicked([]);
  }
  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) setPicked([]);
  };

  const firstName = clientName.split(" ")[0] || clientName;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        <Mail className="h-3.5 w-3.5" />
        Email client
      </button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Email {clientName}</DialogTitle>
            <DialogDescription>
              Goes to <span className="font-medium text-foreground">{clientEmail}</span>,
              the address on their profile.{" "}
              {replyTo ? (
                <>
                  Replies come to{" "}
                  <span className="font-medium text-foreground">{replyTo}</span>.
                </>
              ) : (
                <span className="text-amber-700 dark:text-amber-400">
                  Replies have nowhere to go until you set a contact email in
                  Settings.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="mt-1 space-y-4">
            {state.error && (
              <p className="text-xs font-medium text-destructive">
                {state.error}
              </p>
            )}
            <div className="space-y-1.5">
              <label htmlFor="ce-subject" className="text-xs font-medium">
                Subject
              </label>
              <input
                id="ce-subject"
                name="subject"
                required
                maxLength={200}
                defaultValue={state.values?.subject ?? ""}
                placeholder={`Signed invoice for ${firstName}`}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="ce-body" className="text-xs font-medium">
                Message
              </label>
              <textarea
                id="ce-body"
                name="body"
                required
                rows={6}
                maxLength={10000}
                defaultValue={state.values?.body ?? ""}
                placeholder={`Hi ${firstName},\n\nAttached is the countersigned copy for your records. Let us know if you need anything else.`}
                className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <p className="text-[11px] text-muted-foreground">
                Sent on your company letterhead with your logo and contact
                details. Blank lines become paragraphs.
              </p>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-xs font-medium">Attach</legend>
              {documents.length > 0 ? (
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                  {documents.map((d) => (
                    <li key={d.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted/60">
                        <input
                          type="checkbox"
                          name="document_ids"
                          value={d.id}
                          className="h-3.5 w-3.5"
                        />
                        <span className="min-w-0 flex-1 truncate">{d.label}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {formatBytes(d.size_bytes)}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Nothing on their record yet. Files you add here can be kept
                  there.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "h-8",
                  )}
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  Add file
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  name="files"
                  multiple
                  accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
                  className="hidden"
                  onChange={(e) =>
                    setPicked(Array.from(e.currentTarget.files ?? []))
                  }
                />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    name="keep_uploads"
                    defaultChecked
                    className="h-3.5 w-3.5"
                  />
                  Keep added files in Documents
                </label>
              </div>
              {picked.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {picked.map((f) => (
                    <li
                      key={`${f.name}-${f.size}`}
                      className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]"
                    >
                      <Paperclip className="h-3 w-3" />
                      {f.name}
                      <span className="text-muted-foreground">
                        {formatBytes(f.size)}
                      </span>
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setPicked([]);
                        if (fileInput.current) fileInput.current.value = "";
                      }}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" /> clear
                    </button>
                  </li>
                </ul>
              )}
              <p className="text-[11px] text-muted-foreground">
                PDFs and images. Files added here: 4 MB total. Anything
                bigger, upload to Documents first and tick it above.
              </p>
            </fieldset>

            <DialogFooter>
              <SubmitButton pendingLabel="Sending…">Send email</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
