import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { BookingForm } from "../booking-form";
import { fetchBookingFormOptions } from "../options";

export const metadata = { title: "New booking" };

export default async function NewBookingPage() {
  await requireMembership(["owner", "admin", "manager"]);
  const options = await fetchBookingFormOptions();

  return (
    <PageShell title="New booking" description="Schedule a job for your team.">
      <div className="max-w-3xl rounded-lg border border-border bg-card p-6">
        <BookingForm mode="create" {...options} />
      </div>
    </PageShell>
  );
}
