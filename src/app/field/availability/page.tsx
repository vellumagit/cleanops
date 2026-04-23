import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FieldHeader } from "@/components/field-shell";
import { AvailabilityEditor } from "./availability-editor";

export const metadata = { title: "Availability" };

type SlotRow = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
};

type OverrideRow = {
  id: string;
  date: string;
  kind: "off" | "custom";
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
};

export default async function FieldAvailabilityPage() {
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();

  const [{ data: slots }, { data: overrides }] = await Promise.all([
    supabase
      .from("availability_slots" as never)
      .select("id, day_of_week, start_time, end_time")
      .eq("membership_id" as never, membership.id as never)
      .order("day_of_week" as never, { ascending: true } as never)
      .order("start_time" as never, {
        ascending: true,
      } as never) as unknown as Promise<{
      data: SlotRow[] | null;
    }>,
    supabase
      .from("availability_overrides" as never)
      .select("id, date, kind, start_time, end_time, reason")
      .eq("membership_id" as never, membership.id as never)
      .gte(
        "date" as never,
        new Date().toISOString().slice(0, 10) as never,
      )
      .order("date" as never, {
        ascending: true,
      } as never) as unknown as Promise<{
      data: OverrideRow[] | null;
    }>,
  ]);

  return (
    <>
      <FieldHeader
        title="Availability"
        description="Set your regular hours. Add a one-off if a specific day is different."
      />

      <AvailabilityEditor
        initialSlots={slots ?? []}
        initialOverrides={overrides ?? []}
      />
    </>
  );
}
