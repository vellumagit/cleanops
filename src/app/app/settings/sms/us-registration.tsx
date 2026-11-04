"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormError, FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import {
  BUSINESS_TYPES,
  COMPANY_TYPES,
  INDUSTRIES,
  JOB_POSITIONS,
  US_STATES,
  statusLabel,
  type RegistrationInput,
  type RegistrationStatus,
} from "@/lib/sms-registration-rules";
import {
  checkRegistrationAction,
  saveRegistrationAction,
  type RegistrationFormState,
} from "./registration-actions";

const empty: RegistrationFormState = {};

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const INDUSTRY_LABEL: Record<string, string> = {
  PROFESSIONAL_SERVICES: "Professional services",
  CONSUMER: "Consumer services",
  REAL_ESTATE: "Real estate",
  HOSPITALITY: "Hospitality",
  CONSTRUCTION: "Construction",
  RETAIL: "Retail",
  HEALTHCARE: "Healthcare",
};

/**
 * US texting registration. US carriers block business texts until the
 * business is registered with them; this collects what they check, submits
 * it, and follows it to approval. The number is bought, and texting turned
 * on, by Sollos the moment the carriers approve (twilio-a2p.ts).
 */
export function UsRegistration({
  status,
  statusDetail,
  values,
  einLast4,
  hostedPrivacyUrl,
  hostedTermsUrl,
  submittedAt,
  lastCheckedAt,
  timeZone,
}: {
  status: RegistrationStatus | null;
  statusDetail: string | null;
  values: RegistrationInput;
  einLast4: string | null;
  hostedPrivacyUrl: string;
  hostedTermsUrl: string;
  submittedAt: string | null;
  lastCheckedAt: string | null;
  /** The org's zone, for the submitted / last-checked times. */
  timeZone: string;
}) {
  const [state, action] = useActionState(saveRegistrationAction, empty);
  const [checking, startCheck] = useTransition();
  const router = useRouter();
  const [companyType, setCompanyType] = useState(values.company_type || "private");
  const editable = status == null || status === "draft" || status === "needs_changes";
  const err = state.errors ?? {};

  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone,
        }) : null;

  if (!editable) {
    const approved = status === "approved";
    return (
      <div className="max-w-xl space-y-4">
        <div
          className={
            approved
              ? "flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm"
              : "flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-sm"
          }
        >
          {approved ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          ) : (
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          )}
          <div className="space-y-1">
            <p className="font-medium">{statusLabel(status!)}</p>
            {statusDetail && <p className="text-xs text-muted-foreground">{statusDetail}</p>}
            {!approved && (
              <p className="text-xs text-muted-foreground">
                Submitted {when(submittedAt) ?? "—"}. Sollos checks every hour
                {lastCheckedAt ? `, last at ${when(lastCheckedAt)}` : ""}. When the carriers approve, Sollos buys your
                number and turns texting on. Nothing for you to do until then.
              </p>
            )}
          </div>
        </div>
        {!approved && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={checking}
            onClick={() =>
              startCheck(async () => {
                await checkRegistrationAction();
                router.refresh();
              })
            }
          >
            <RefreshCw className={checking ? "mr-1.5 h-3.5 w-3.5 animate-spin" : "mr-1.5 h-3.5 w-3.5"} />
            Check now
          </Button>
        )}
      </div>
    );
  }

  const field = (
    name: keyof RegistrationInput,
    label: string,
    opts: { hint?: string; required?: boolean; type?: string; placeholder?: string; autoComplete?: string } = {},
  ) => (
    <FormField label={label} htmlFor={`reg-${name}`} error={err[name]} hint={opts.hint} required={opts.required}>
      <Input
        id={`reg-${name}`}
        name={name}
        type={opts.type ?? "text"}
        defaultValue={values[name]}
        placeholder={opts.placeholder}
        autoComplete={opts.autoComplete}
      />
    </FormField>
  );

  return (
    <form action={action} className="max-w-xl space-y-6">
      <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-sm">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="font-medium">Register your business for US texting</p>
          <p className="text-xs text-muted-foreground">
            US carriers block business texts until the business is registered with them. Fill this in once; Sollos
            submits it, follows it, and turns texting on with a local number as soon as it&apos;s approved. Approval
            usually takes one to three weeks. Email notifications keep working the whole time.
          </p>
        </div>
      </div>

      {status === "needs_changes" && statusDetail && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>Needs changes.</strong> {statusDetail} Fix the details below and submit again.
          </span>
        </div>
      )}
      <FormError message={err._form} />
      {state.saved && <p className="text-xs text-emerald-700 dark:text-emerald-400">Saved. Submit when it&apos;s ready.</p>}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">The business</h3>
        {field("legal_name", "Legal business name", {
          required: true,
          hint: "Exactly as on the IRS letter that issued your EIN, including LLC or Inc.",
        })}
        {field("brand_name", "Name customers know you by", {
          hint: "Starts every text, like “Keep'n It Kleen: your cleaning is confirmed…”. Defaults to the legal name.",
        })}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Business type" htmlFor="reg-business_type" error={err.business_type} required>
            <select id="reg-business_type" name="business_type" defaultValue={values.business_type} className={selectClass}>
              {BUSINESS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === "Limited Liability Corporation" ? "LLC" : t}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            label="EIN"
            htmlFor="reg-ein"
            error={err.ein}
            required={!einLast4}
            hint={einLast4 ? `On file, ending ${einLast4}. Leave blank to keep it.` : "Your 9-digit federal tax ID."}
          >
            <Input id="reg-ein" name="ein" inputMode="numeric" placeholder="12-3456789" autoComplete="off" />
          </FormField>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Ownership" htmlFor="reg-company_type" error={err.company_type} required>
            <select
              id="reg-company_type"
              name="company_type"
              value={companyType}
              onChange={(e) => setCompanyType(e.target.value)}
              className={selectClass}
            >
              {COMPANY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === "private" ? "Privately owned" : t === "public" ? "Publicly traded" : "Non-profit"}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Industry" htmlFor="reg-industry" error={err.industry} required>
            <select id="reg-industry" name="industry" defaultValue={values.industry} className={selectClass}>
              {INDUSTRIES.map((t) => (
                <option key={t} value={t}>
                  {INDUSTRY_LABEL[t] ?? t}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        {companyType === "public" && (
          <div className="grid gap-3 sm:grid-cols-2">
            {field("stock_exchange", "Stock exchange", { placeholder: "NASDAQ" })}
            {field("stock_ticker", "Ticker symbol")}
          </div>
        )}
        {field("website_url", "Website", {
          required: true,
          placeholder: "yourcompany.com",
          hint: "Carriers open it to check it's live and belongs to you. A parked or login-only page is rejected.",
        })}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Business address</h3>
        {field("street", "Street", { required: true, autoComplete: "address-line1" })}
        {field("street2", "Suite or unit", { autoComplete: "address-line2" })}
        <div className="grid gap-3 sm:grid-cols-3">
          {field("city", "City", { required: true, autoComplete: "address-level2" })}
          <FormField label="State" htmlFor="reg-state" error={err.state} required>
            <select id="reg-state" name="state" defaultValue={values.state} className={selectClass}>
              <option value="">—</option>
              {US_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </FormField>
          {field("postal_code", "ZIP", { required: true, autoComplete: "postal-code" })}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Who the carriers can contact</h3>
        <p className="text-xs text-muted-foreground">
          An owner or officer. The email must be on your business&apos;s own domain; carriers reject Gmail, Yahoo and
          similar. They may email a verification step to it.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("rep_first_name", "First name", { required: true, autoComplete: "given-name" })}
          {field("rep_last_name", "Last name", { required: true, autoComplete: "family-name" })}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("rep_title", "Job title", { required: true, placeholder: "Owner" })}
          <FormField label="Position" htmlFor="reg-rep_job_position" error={err.rep_job_position} required>
            <select id="reg-rep_job_position" name="rep_job_position" defaultValue={values.rep_job_position} className={selectClass}>
              {JOB_POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("rep_email", "Email", { required: true, type: "email", autoComplete: "email" })}
          {field("rep_phone", "Phone", { required: true, type: "tel", autoComplete: "tel" })}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">What customers see</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("support_phone", "Phone for customer help", {
            type: "tel",
            hint: "Sent when a customer texts HELP. Defaults to the phone above.",
          })}
          {field("support_email", "Email for customer help", { type: "email", hint: "Defaults to the email above." })}
        </div>
        {field("privacy_url", "Privacy policy page (optional)", {
          hint: `Leave blank to use the texting privacy page Sollos hosts for you: ${hostedPrivacyUrl}`,
        })}
        {field("terms_url", "Texting terms page (optional)", {
          hint: `Leave blank to use ${hostedTermsUrl}`,
        })}
      </section>

      <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
        <p>
          <strong className="text-foreground">Before you submit.</strong> The carriers charge a registration fee for
          each business and a monthly fee while texting is on. Sollos describes your texts to them as appointment
          confirmations, reminders, schedule changes, invoices and receipts, sent only to customers who reply YES to
          your consent request. No marketing texts.
        </p>
        <div className="flex flex-wrap gap-2">
          <SubmitButton name="intent" value="submit" pendingLabel="Submitting…">
            Submit to the carriers
          </SubmitButton>
          <SubmitButton name="intent" value="save" variant="outline" pendingLabel="Saving…">
            Save for later
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
