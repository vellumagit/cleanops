import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { ReviewForm } from "../review-form";
import { fetchReviewFormOptions } from "../options";

export const metadata = { title: "New review" };

export default async function NewReviewPage() {
  await requireMembership(["owner", "admin"]);
  const options = await fetchReviewFormOptions();

  return (
    <PageShell
      title="New review"
      description="Record client feedback for a completed job."
    >
      <div className="max-w-3xl rounded-lg border border-border bg-card p-6">
        <ReviewForm {...options} />
      </div>
    </PageShell>
  );
}
