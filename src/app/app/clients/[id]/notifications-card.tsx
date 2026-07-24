import Link from "next/link";
import { Bell, Mail, MessageSquare, Ban, Pencil } from "lucide-react";
import {
  summarizeClientChannels,
  type ContactOverrides,
  type ClientContactPreference,
  type OrgContactDefault,
  type NotificationCategory,
  type ResolvedChannels,
} from "@/lib/notification-preferences";

/**
 * "How we contact this client" — surfaced on the client DETAIL page, because
 * that's where you look a client up. The edit form is where you change it;
 * this card makes the current state visible without hunting for it, and links
 * straight to the control (anchored) for changes.
 *
 * Shows the RESOLVED outcome per category (org default + this client's setting
 * + SMS consent), in words — not the raw switches.
 */

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  booking: "Booking updates",
  billing: "Billing",
  growth: "Reviews & rebooking",
};

function channelText(r: ResolvedChannels): {
  text: string;
  muted: boolean;
} {
  if (r.email && r.sms) return { text: "Email + text", muted: false };
  if (r.email) return { text: "Email", muted: false };
  if (r.sms) return { text: "Text", muted: false };
  if (r.reason === "sms_not_opted_in")
    return { text: "Nothing — texts chosen but not opted in", muted: true };
  if (r.reason === "no_email_address")
    return { text: "Nothing — no email on file", muted: true };
  return { text: "Nothing", muted: true };
}

export function ClientNotificationsCard({
  clientId,
  canEdit,
  orgDefault,
  contactPreference,
  contactOverrides,
  hasEmail,
  smsOptedIn,
}: {
  clientId: string;
  canEdit: boolean;
  orgDefault: OrgContactDefault;
  contactPreference: string | null;
  contactOverrides: ContactOverrides | null;
  hasEmail: boolean;
  smsOptedIn: boolean;
}) {
  const pref = (contactPreference ?? "inherit") as ClientContactPreference;
  const isDnc = pref === "do_not_contact";
  const summary = summarizeClientChannels({
    orgDefault,
    clientPref: pref,
    overrides: contactOverrides ?? {},
    hasEmail,
    smsOptedIn,
  });

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Notifications</h3>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              isDnc
                ? "bg-red-500/10 text-red-700 dark:text-red-400"
                : pref === "custom"
                  ? "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {isDnc
              ? "Do not contact"
              : pref === "custom"
                ? "Custom"
                : "Follows org default"}
          </span>
        </div>
        {canEdit && (
          <Link
            href={`/app/clients/${clientId}/edit#notifications`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
            Change
          </Link>
        )}
      </div>

      {isDnc ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Ban className="h-3.5 w-3.5 text-red-500" />
          This client receives no automated messages of any kind. You can still
          email or text them manually.
        </p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {(Object.keys(CATEGORY_LABEL) as NotificationCategory[]).map(
            (cat) => {
              const r = summary[cat];
              const { text, muted } = channelText(r);
              const IconEl = r.sms && !r.email ? MessageSquare : Mail;
              return (
                <div
                  key={cat}
                  className="rounded-md border border-border bg-background px-3 py-2"
                >
                  <p className="text-[11px] text-muted-foreground">
                    {CATEGORY_LABEL[cat]}
                  </p>
                  <p
                    className={`mt-0.5 flex items-center gap-1.5 text-xs font-medium ${
                      muted ? "text-muted-foreground" : "text-foreground"
                    }`}
                  >
                    {!muted && <IconEl className="h-3 w-3" />}
                    {text}
                  </p>
                </div>
              );
            },
          )}
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        Org-wide rules live in{" "}
        <Link
          href="/app/settings/automations"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Settings → Automations
        </Link>
        . This card is what this client actually gets.
      </p>
    </div>
  );
}
