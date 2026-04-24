import { requireClient } from "@/lib/client-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RequestForm } from "./request-form";

export const metadata = { title: "Request a booking" };

export default async function ClientRequestPage() {
  const client = await requireClient();
  const supabase = await createSupabaseServerClient();

  // Pull the default address off the client record so we can pre-fill
  // the form. RLS lets the client read their own clients row.
  const { data } = (await supabase
    .from("clients")
    .select("address")
    .eq("id", client.id)
    .maybeSingle()) as unknown as {
    data: { address: string | null } | null;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Request a booking</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Tell us what you need and when — we&rsquo;ll confirm details and put
          it on the calendar.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <RequestForm defaultAddress={data?.address ?? null} />
      </div>
    </div>
  );
}
