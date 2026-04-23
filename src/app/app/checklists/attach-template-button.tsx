"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/form-field";
import { attachTemplateToBookingAction } from "./actions";

type Template = { id: string; name: string };

/**
 * Inline dropdown + button for attaching a checklist template to a booking.
 * Meant to sit in the admin booking detail page next to the checklist
 * items so it's discoverable on the jobs where it matters.
 */
export function AttachTemplateButton({
  bookingId,
  templates,
}: {
  bookingId: string;
  templates: Template[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState("");

  if (templates.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No templates yet.{" "}
        <Link
          href="/app/checklists/new"
          className="text-primary underline-offset-2 hover:underline"
        >
          Create one
        </Link>{" "}
        to attach it here.
      </p>
    );
  }

  function attach() {
    if (!selected) return;
    const fd = new FormData();
    fd.set("template_id", selected);
    fd.set("booking_id", bookingId);
    startTransition(async () => {
      const res = await attachTemplateToBookingAction(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Checklist attached");
      setSelected("");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <FormSelect
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="flex-1"
      >
        <option value="">Pick a template…</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </FormSelect>
      <Button
        type="button"
        size="sm"
        onClick={attach}
        disabled={!selected || pending}
      >
        <Plus className="h-3.5 w-3.5" />
        {pending ? "…" : "Attach"}
      </Button>
    </div>
  );
}
