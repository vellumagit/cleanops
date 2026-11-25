import Link from "next/link";
import { ChevronLeft, Users, Sparkles, TriangleAlert } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { SubmitButton } from "@/components/submit-button";
import { setOrgContactDefaultAction, applyAutomationPresetAction } from "./actions";
import { ClientAutomationMatrix, type MatrixClientRow } from "./client-matrix";
import {
  AutomationStageList,
  CLIENT_STAGES,
  MasterSwitchBanner,
  OtherAutomationPages,
  QuietModeCard,
} from "./automation-catalog";
import {
  EMPTY_THRESHOLDS,
  THRESHOLD_SELECT,
  type ThresholdValues,
} from "@/app/app/settings/thresholds/threshold-fields";

export const metadata = { title: "Client messages" };

/**
 * Settings → Client messages: everything Sollos says to clients, in the order
 * a job lives (won, booked, the day before, done and paid, growing), plus who
 * receives them. The team half of what used to be one Automations page lives
 * at /app/settings/team-alerts; the address here stayed, so links in emails,
 * notices and the help guides keep working.
 */

/** The three starting bundles. Key sets live in actions.ts. */
const PRESET_CARDS = [
  {
    preset: "essentials",
    label: "The essentials",
    blurb:
      "Confirm bookings, remind the day before, draft + chase invoices, receipt on payment. 8 automations.",
    recommended: true,
  },
  {
    preset: "full_service",
    label: "Full service",
    blurb:
      "Essentials plus reviews, rebooking nudges, estimate follow-ups, crew schedules, and digests. 18 automations.",
    recommended: false,
  },
  {
    preset: "custom",
    label: "I'll pick myself",
    blurb: "Turns automations on but enables nothing — choose one by one.",
    recommended: false,
  },
];

export default async function ClientMessagesPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const admin = createSupabaseAdminClient();

  const [{ data: org }, { data: clientRows }] = await Promise.all([
    admin
      .from("organizations")
      .select(
        `automation_settings, default_contact_preference, automations_enabled, quiet_mode, sms_enabled, ${THRESHOLD_SELECT}`,
      )
      .eq("id", membership.organization_id)
      .maybeSingle() as unknown as Promise<{
      data:
        | ({
            automation_settings: Record<string, { enabled: boolean }>;
            default_contact_preference: string | null;
            automations_enabled: boolean | null;
            quiet_mode: boolean | null;
            sms_enabled: boolean | null;
          } & ThresholdValues)
        | null;
    }>,
    // The per-client manager — active clients only.
    admin
      .from("clients")
      .select("id, name, email, phone, sms_opted_in, contact_preference, contact_overrides")
      .eq("organization_id", membership.organization_id)
      .is("archived_at", null)
      .order("name", { ascending: true })
      .limit(500) as unknown as Promise<{ data: MatrixClientRow[] | null }>,
  ]);

  const settings = org?.automation_settings ?? {};
  const contactDefault = org?.default_contact_preference ?? "email";
  const masterOn = org?.automations_enabled === true;
  const smsEnabled = org?.sms_enabled === true;
  const enabledCount = Object.values(settings).filter(
    (v) => (v as { enabled?: boolean })?.enabled === true,
  ).length;
  const houseDefault = (
    ["email", "sms", "both", "none"].includes(contactDefault) ? contactDefault : "email"
  ) as "email" | "sms" | "both" | "none";

  return (
    <PageShell
      title="Client messages"
      description="Everything Sollos says to your clients — confirmations, reminders, invoices, review asks — and who receives it."
      actions={
        <Link
          href="/app/settings"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Settings
        </Link>
      }
    >
      <MasterSwitchBanner masterOn={masterOn} enabledCount={enabledCount} />
      <QuietModeCard quiet={org?.quiet_mode === true} />
      <OtherAutomationPages current="client" />

      {/* HOW IT WORKS — the decision chain, permanently visible. */}
      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-[11px] text-muted-foreground">
        <span className="mr-1">How a client message decides to send:</span>
        <span className="rounded-md border border-border bg-background px-2 py-1 font-medium text-foreground">
          1 · Message turned on below
        </span>
        <span aria-hidden>→</span>
        <span className="rounded-md border border-border bg-background px-2 py-1 font-medium text-foreground">
          2 · That client&apos;s settings
        </span>
        <span aria-hidden>→</span>
        <span className="rounded-md border border-border bg-background px-2 py-1 font-medium text-foreground">
          3 · Texts need the client&apos;s opt-in
        </span>
        <span className="basis-full text-[11px]">
          Delivery is decided by the house default plus each client&apos;s own
          settings — in the per-client manager below or on{" "}
          <Link href="/app/clients" className="underline underline-offset-2">
            their client page
          </Link>
          .
        </span>
      </div>

      {/* PRESETS — the first decision is one click, not thirty-nine. */}
      <div className="mb-8">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Start from a preset — fine-tune anything after. Presets only turn
          things on; they never switch off something you enabled. The larger
          ones also switch on invoice drafting and a few team alerts.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {PRESET_CARDS.map((p) => (
            <form
              key={p.preset}
              action={applyAutomationPresetAction}
              className={`relative flex flex-col rounded-xl border bg-card p-4 ${
                p.recommended ? "border-emerald-500/50" : "border-border"
              }`}
            >
              {p.recommended && (
                <span className="absolute -top-2 left-3 flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                  <Sparkles className="h-3 w-3" /> Recommended
                </span>
              )}
              <input type="hidden" name="preset" value={p.preset} />
              <p className="text-sm font-medium">{p.label}</p>
              <p className="mt-1 flex-1 text-xs text-muted-foreground">{p.blurb}</p>
              <SubmitButton
                variant={p.recommended ? "default" : "outline"}
                size="sm"
                pendingLabel="Applying…"
                className="mt-3"
              >
                {p.preset === "custom" ? "Start empty" : `Use ${p.label.toLowerCase()}`}
              </SubmitButton>
            </form>
          ))}
        </div>
      </div>

      <section className="mb-10">
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sky-500/15">
            <Users className="h-4 w-4 text-sky-600 dark:text-sky-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Messages, in the order a job happens</h2>
            <p className="text-xs text-muted-foreground">
              Turn messages on here, then decide who receives them just below.
            </p>
          </div>
        </div>
        <AutomationStageList
          stages={CLIENT_STAGES}
          settings={settings}
          masterOn={masterOn}
          thresholds={org ?? EMPTY_THRESHOLDS}
        />

        {/* WHO RECEIVES THEM — the delivery dial for client messages. */}
        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium">Default client notifications</p>
          <p className="mt-1 text-xs text-muted-foreground">
            What a client gets unless their own setting says otherwise. Pick
            &ldquo;No notifications&rdquo; to keep new clients silent until
            you configure them one by one in the manager below.
          </p>
          <form action={setOrgContactDefaultAction} className="mt-3 flex flex-wrap items-center gap-2">
            {[
              { value: "email", label: "Email only" },
              { value: "sms", label: "Text only" },
              { value: "both", label: "Email + text" },
              { value: "none", label: "No notifications" },
            ].map((opt) => {
              const active = contactDefault === opt.value;
              return (
                <button
                  key={opt.value}
                  type="submit"
                  name="default_contact_preference"
                  value={opt.value}
                  className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                    active
                      ? "border-foreground bg-muted font-medium text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </form>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Texts only reach clients who have opted in to SMS, regardless of
            this setting. Booking and billing messages can go by text; review
            &amp; rebooking messages are email-only.
          </p>
          {contactDefault === "sms" && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                With &ldquo;Text only&rdquo; as the default, review asks and
                rebooking nudges never send to clients on the default — those
                are email-only. Booking and billing texts only reach clients
                who have opted in to SMS. Clients with their own email
                setting are unaffected.
              </span>
            </p>
          )}
        </div>

        <div className={`mt-4 ${masterOn ? "" : "pointer-events-none opacity-50"}`}>
          <ClientAutomationMatrix
            rows={clientRows ?? []}
            smsEnabled={smsEnabled}
            orgDefault={houseDefault}
          />
        </div>
      </section>
    </PageShell>
  );
}
