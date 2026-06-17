import { RefreshCw, Trash2, Plus } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CopyUrl } from "./copy-url";
import {
  createIntakeFormAction,
  regenerateIntakeTokenAction,
  toggleIntakeFormAction,
  deleteIntakeFormAction,
} from "./actions";

export const metadata = { title: "Intake forms" };

type IntakeForm = {
  id: string;
  name: string;
  type: string;
  token: string;
  active: boolean;
};

const TYPE_LABEL: Record<string, string> = {
  job_application: "Job application → Applicants",
};

export default async function IntakeFormsPage() {
  await requireMembership(["owner", "admin"]);
  const supabase = await createSupabaseServerClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

  const { data } = (await supabase
    .from("intake_forms" as never)
    .select("id, name, type, token, active")
    .order("created_at" as never, { ascending: true } as never)) as unknown as {
    data: IntakeForm[] | null;
  };
  const forms = data ?? [];

  return (
    <PageShell
      title="Intake forms"
      description="Point any external form (your website, Typeform, Jotform, Zapier…) at one of these URLs and submissions land in Sollos automatically."
    >
      <div className="space-y-4">
        {forms.map((f) => (
          <div
            key={f.id}
            className="rounded-xl border border-border bg-card p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{f.name}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {TYPE_LABEL[f.type] ?? f.type}
                </p>
              </div>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  f.active
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {f.active ? "Active" : "Disabled"}
              </span>
            </div>

            <div className="mt-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Webhook URL (POST here)
              </p>
              <CopyUrl url={`${siteUrl}/api/intake/${f.token}`} />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <form action={regenerateIntakeTokenAction}>
                <input type="hidden" name="id" value={f.id} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Regenerate URL
                </button>
              </form>
              <form action={toggleIntakeFormAction}>
                <input type="hidden" name="id" value={f.id} />
                <input type="hidden" name="active" value={String(f.active)} />
                <button
                  type="submit"
                  className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  {f.active ? "Disable" : "Enable"}
                </button>
              </form>
              <form action={deleteIntakeFormAction} className="ml-auto">
                <input type="hidden" name="id" value={f.id} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </form>
            </div>
          </div>
        ))}

        {/* Create */}
        <form
          action={createIntakeFormAction}
          className="rounded-xl border border-dashed border-border bg-card p-5"
        >
          <h2 className="mb-3 text-sm font-semibold">New intake form</h2>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div>
              <label
                htmlFor="name"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                Name
              </label>
              <Input id="name" name="name" placeholder="Job application form" />
            </div>
            <div>
              <label
                htmlFor="type"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                Type
              </label>
              <select
                id="type"
                name="type"
                defaultValue="job_application"
                className="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <option value="job_application">Job application</option>
              </select>
            </div>
            <Button type="submit">
              <Plus className="h-4 w-4" /> Create
            </Button>
          </div>
        </form>

        {/* Field reference */}
        <div className="rounded-xl border border-border bg-muted/30 p-5 text-sm">
          <h2 className="mb-2 text-sm font-semibold">
            Job application — fields we recognize
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Send any of these field names (JSON or form-encoded). Anything
            extra is still saved and shown on the applicant. Nothing is
            required — but include at least a name or email.
          </p>
          <ul className="grid gap-1.5 text-xs sm:grid-cols-2">
            <li><code>name</code> / <code>full_name</code></li>
            <li><code>email</code></li>
            <li><code>phone</code></li>
            <li><code>position</code> / <code>role</code></li>
            <li><code>experience</code></li>
            <li><code>availability</code></li>
            <li><code>message</code> / <code>cover_letter</code></li>
            <li><code>resume_url</code> / <code>resume</code></li>
          </ul>
        </div>
      </div>
    </PageShell>
  );
}
