"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/form-field";
import { uploadBillAction } from "../actions";

/** Dialog form for uploading an invoice a subcontractor sent. */
export function UploadBillForm({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("contact_id", contactId);
    startTransition(async () => {
      const res = await uploadBillAction(fd);
      if (res.ok) {
        toast.success("Invoice uploaded");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Upload className="h-3.5 w-3.5" />
        Upload invoice
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload invoice</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <FormField
            label="File"
            htmlFor="file"
            required
            hint="PDF or image, up to 15 MB."
          >
            <Input id="file" name="file" type="file" required />
          </FormField>
          <FormField
            label="Label"
            htmlFor="label"
            hint="Defaults to the file name if left blank."
          >
            <Input id="label" name="label" type="text" />
          </FormField>
          <FormField label="Amount" htmlFor="amount">
            <Input
              id="amount"
              name="amount"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              placeholder="0.00"
            />
          </FormField>
          <FormField label="Invoice date" htmlFor="bill_date">
            <Input id="bill_date" name="bill_date" type="date" />
          </FormField>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Upload
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
