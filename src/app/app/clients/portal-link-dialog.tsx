"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Shown right after a portal invite is made: the link itself, to copy.
 *
 * The invite used to exist only inside an email. If that email was slow, in
 * spam, or to an address the office mistyped, there was no other way in, and
 * nothing on screen said where a client goes to sign in. The link can only
 * be shown now: it is stored scrambled, so closing this means sending a new
 * invite to see one again.
 */
export function PortalLinkDialog({
  link,
  email,
  onClose,
}: {
  /** The invite link, or null when there is nothing to show. */
  link: string | null;
  email: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const signIn = link ? `${new URL(link).origin}/client/login` : "";

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Invite link copied");
    } catch {
      toast.error("Couldn't copy. Select the link and copy it by hand.");
    }
  }

  return (
    <Dialog
      open={Boolean(link)}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Portal invite sent</DialogTitle>
          <DialogDescription>
            An email is on its way to {email ?? "the client"} with this link. You can also
            copy it and send it yourself, by text for example. It works once, for 14 days.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={link ?? ""}
              aria-label="Portal invite link"
              data-testid="portal-invite-link"
              onFocus={(e) => e.currentTarget.select()}
              className="h-10 min-w-0 flex-1 rounded-md border border-input bg-muted/40 px-3 font-mono text-xs"
            />
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
            <li>The client opens the link and presses one button. There is no password to set up.</li>
            <li>
              After that, or without any invite, they get in by typing the email you have for them at{" "}
              <span className="font-mono text-foreground">{signIn.replace(/^https?:\/\//, "")}</span>.
            </li>
            <li>
              To try it yourself, open the link in a private window: in this window you are
              signed in as staff, and the link will say so.
            </li>
          </ol>
          <p className="text-xs text-muted-foreground">
            This link is shown only now. Sending the invite again makes a new one and
            switches this one off.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
