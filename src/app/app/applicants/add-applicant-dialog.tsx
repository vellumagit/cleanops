"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { addApplicantAction, type AddApplicantState } from "./actions";

const initial: AddApplicantState = {};

/**
 * Add an applicant by hand: someone who phoned, walked in, or was referred.
 * Until this existed the only way onto the list was the hiring form on the
 * company's website.
 */
export function AddApplicantDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(addApplicantAction, initial);

  useEffect(() => {
    if (state.addedId) {
      toast.success("Applicant added");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      router.push(`/app/applicants/${state.addedId}`);
    }
  }, [state.addedId, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <UserPlus className="h-4 w-4" />
        Add applicant
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add an applicant</DialogTitle>
          <DialogDescription>
            For someone who phoned, walked in, or was referred. Only the name
            is needed; add the rest as you learn it.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="applicant_name">Name</Label>
            <Input id="applicant_name" name="name" required maxLength={200} autoComplete="off" />
            {state.errors?.name && <p className="text-xs text-destructive">{state.errors.name}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="applicant_email">Email</Label>
              <Input id="applicant_email" name="email" type="email" maxLength={200} autoComplete="off" />
              {state.errors?.email && <p className="text-xs text-destructive">{state.errors.email}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="applicant_phone">Phone</Label>
              <Input id="applicant_phone" name="phone" type="tel" maxLength={40} autoComplete="off" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="applicant_position">Applying for</Label>
            <Input id="applicant_position" name="position" maxLength={200} placeholder="e.g. Cleaner, part time" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="applicant_notes">Notes</Label>
            <Textarea
              id="applicant_notes"
              name="notes"
              rows={3}
              maxLength={4000}
              placeholder="How they reached you, experience, when they can start."
            />
          </div>
          {state.errors?._form && <p className="text-sm text-destructive">{state.errors._form}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add applicant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
