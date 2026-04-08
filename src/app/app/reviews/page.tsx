import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { ReviewsTable, type ReviewRow } from "./reviews-table";

export const metadata = { title: "Reviews" };

export default async function ReviewsPage() {
  await requireMembership();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("reviews")
    .select(
      `
        id,
        rating,
        comment,
        submitted_at,
        client:clients ( name ),
        employee:memberships ( profile:profiles ( full_name ) )
      `,
    )
    .order("submitted_at", { ascending: false })
    .limit(200);

  if (error) throw error;

  const rows: ReviewRow[] = (data ?? []).map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    submitted_at: r.submitted_at,
    client_name: r.client?.name ?? "Anonymous",
    employee_name: r.employee?.profile?.full_name ?? null,
  }));

  return (
    <PageShell
      title="Reviews"
      description="Client feedback after each completed job."
    >
      <ReviewsTable rows={rows} />
    </PageShell>
  );
}
