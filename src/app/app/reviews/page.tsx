import Link from "next/link";
import { Plus } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { ReviewsFilters } from "./reviews-filters";
import { ReviewsTable, type ReviewRow } from "./reviews-table";

export const metadata = { title: "Reviews" };

type SearchParams = { employee?: string; min_rating?: string };

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const membership = await requireMembership();
  const canEdit = membership.role === "owner" || membership.role === "admin";
  const params = await searchParams;
  const employeeFilter =
    params.employee && params.employee !== "" ? params.employee : null;
  const minRatingFilter = params.min_rating ? Number(params.min_rating) : null;

  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("reviews")
    .select(
      `
        id,
        rating,
        comment,
        submitted_at,
        employee_id,
        client:clients ( name ),
        employee:memberships ( profile:profiles ( full_name ) )
      `,
    )
    .order("submitted_at", { ascending: false })
    .limit(200);

  if (employeeFilter) query = query.eq("employee_id", employeeFilter);
  if (minRatingFilter && Number.isFinite(minRatingFilter))
    query = query.gte("rating", minRatingFilter);

  const [reviewsResult, employeesResult] = await Promise.all([
    query,
    supabase
      .from("memberships")
      .select("id, profile:profiles ( full_name )")
      .eq("status", "active"),
  ]);

  if (reviewsResult.error) throw reviewsResult.error;

  const rows: ReviewRow[] = (reviewsResult.data ?? []).map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    submitted_at: r.submitted_at,
    client_name: r.client?.name ?? "Anonymous",
    employee_name: r.employee?.profile?.full_name ?? null,
  }));

  const employeeOptions =
    employeesResult.data?.map((m) => ({
      id: m.id,
      label: m.profile?.full_name ?? "Unnamed",
    })) ?? [];

  return (
    <PageShell
      title="Reviews"
      description="Client feedback after each completed job."
      actions={
        canEdit ? (
          <Link
            href="/app/reviews/new"
            className={buttonVariants({ variant: "default" })}
          >
            <Plus className="h-4 w-4" />
            New review
          </Link>
        ) : null
      }
    >
      <div className="space-y-4">
        <ReviewsFilters
          employees={employeeOptions}
          employee={employeeFilter ?? ""}
          minRating={params.min_rating ?? ""}
        />
        <ReviewsTable rows={rows} canEdit={canEdit} />
      </div>
    </PageShell>
  );
}
