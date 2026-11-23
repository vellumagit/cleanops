"use client";

import { useActionState, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { PRICE_MODES, nameProblem, tidyName, type PriceMode } from "@/lib/booking-page-rules";
import {
  createBookingPageAction,
  saveBookingPageAction,
  setBookingPagePublishedAction,
  type OnlineBookingState,
} from "./actions";

const empty: OnlineBookingState = {};

type Page = { slug: string; status: "draft" | "published"; headline: string | null; intro: string | null };
type Service = {
  id: string;
  name: string;
  price: string | null;
  /** The booked length, "2h", or null when the service has none. */
  length: string | null;
  /** How many cleaners the job needs when booked online. */
  crewSize: number;
  show: boolean;
  priceMode: PriceMode;
};

export function OnlineBookingForm({
  site,
  page,
  suggestion,
  services,
}: {
  /** "https://sollos3.com" */
  site: string;
  page: Page | null;
  suggestion: string;
  services: Service[];
}) {
  return page ? <Editor site={site} page={page} services={services} /> : <Claim site={site} suggestion={suggestion} />;
}

const host = (site: string) => site.replace(/^https?:\/\//, "");

function Notice({ state }: { state: OnlineBookingState }) {
  if (!state.ok) return null;
  return (
    <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
      {state.ok}
    </p>
  );
}

/** No page yet: say what it is, and claim the name. */
function Claim({ site, suggestion }: { site: string; suggestion: string }) {
  const [state, create] = useActionState(createBookingPageAction, empty);
  const [name, setName] = useState(suggestion);
  const tidy = tidyName(name);
  const problem = name.trim() ? nameProblem(tidy) : null;

  return (
    <div className="max-w-2xl space-y-5">
      <div className="rounded-lg border border-border bg-card p-5 text-sm">
        <p className="font-medium">You don&rsquo;t have a booking page yet.</p>
        <p className="mt-1 text-muted-foreground">
          It is a page of your own, with your logo and colour, where a client can ask for a clean and sign in to
          see their visits and invoices. You choose the link, build it as a draft, look at it, and publish it when
          you are ready. Nothing is public until you publish.
        </p>
      </div>

      <form action={create} className="space-y-4 rounded-lg border border-border bg-card p-5">
        <FormError message={state.error} />
        <Notice state={state} />
        <FormField label="Choose your link" htmlFor="name" required hint="Usually your company's name. Letters, numbers and hyphens.">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-sm text-muted-foreground">{host(site)}/book/</span>
            <Input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="your-company" className="min-w-0" />
          </div>
        </FormField>
        {name.trim() && (
          <p className={problem ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
            {problem ?? (
              <>
                Your link will be <span className="font-mono text-foreground [overflow-wrap:anywhere]">{host(site)}/book/{tidy}</span>
              </>
            )}
          </p>
        )}
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Making it…">Make my page, as a draft</SubmitButton>
        </div>
      </form>
    </div>
  );
}

/** The page exists: its state, its link, and what is on it. */
function Editor({ site, page, services }: { site: string; page: Page; services: Service[] }) {
  const [saveState, save] = useActionState(saveBookingPageAction, empty);
  const [pubState, setPublished] = useActionState(setBookingPagePublishedAction, empty);
  const [name, setName] = useState(page.slug);
  const [copied, setCopied] = useState(false);
  const live = page.status === "published";
  const link = `${site}/book/${page.slug}`;
  const tidy = tidyName(name);
  const renaming = tidy !== page.slug;
  const problem = nameProblem(tidy);
  const shownCount = services.filter((s) => s.show).length;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The link is on screen to select by hand.
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div className="space-y-3 rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="page-status"
            className={
              live
                ? "rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400"
                : "rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400"
            }
          >
            {live ? "Live" : "Draft"}
          </span>
          <span className="text-sm text-muted-foreground">
            {live ? "Anyone with the link can open your page." : "Only you and your office can open it. Nobody else can."}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 rounded-md border border-input bg-muted/40 px-3 py-2 font-mono text-xs [overflow-wrap:anywhere]" data-testid="page-link">
            {host(site)}/book/{page.slug}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={copy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <a
            href={`/book/${page.slug}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
          >
            <ExternalLink className="h-4 w-4" />
            {live ? "Open it" : "Preview"}
          </a>
        </div>
        <FormError message={pubState.error} />
        <Notice state={pubState} />
        <form action={setPublished} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <input type="hidden" name="publish" value={live ? "0" : "1"} />
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {live
              ? "Taking it down keeps everything you set up. The link shows \"not found\" until you publish again."
              : shownCount === 0
                ? "No services are ticked to show yet. You can still publish: the page will take requests without a list."
                : "Look at the preview first. When you are happy, publish it."}
          </p>
          <SubmitButton pendingLabel={live ? "Taking it down…" : "Publishing…"} variant={live ? "outline" : "default"}>
            {live ? "Take it down" : "Publish"}
          </SubmitButton>
        </form>
      </div>

      <form action={save} className="space-y-5 rounded-lg border border-border bg-card p-5">
        <FormError message={saveState.error} />
        <Notice state={saveState} />

        <FormField label="Headline" htmlFor="headline" hint="The first line a visitor reads. Leave it empty to use your company's name.">
          <Input id="headline" name="headline" maxLength={120} defaultValue={page.headline ?? ""} placeholder="House cleaning you can count on" />
        </FormField>

        <FormField label="A few words about you" htmlFor="intro" hint="Who you are, where you work, what makes you different. A short paragraph is plenty.">
          <Textarea id="intro" name="intro" rows={4} maxLength={1500} defaultValue={page.intro ?? ""} />
        </FormField>

        <div>
          <p className="text-sm font-medium">Services on your page</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Tick the ones a visitor should see, choose whether each shows a price, and say how many cleaners it
            takes. Prices and lengths come from Settings, Services; a length is the hours for one person.
          </p>
          {services.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">You have no services yet. Add them in Settings, Services.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-md border border-border">
              {services.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                  <input type="hidden" name={`listed_${s.id}`} value="1" />
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                    <input type="checkbox" name="show" value={s.id} defaultChecked={s.show} className="h-4 w-4 shrink-0 rounded border-input" />
                    <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{s.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {s.price ?? "no price set"} · {s.length ?? "no length set"}
                    </span>
                  </label>
                  <FormSelect name={`price_${s.id}`} defaultValue={s.priceMode} aria-label={`How ${s.name} shows its price`} className="w-full sm:w-52">
                    {PRICE_MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </FormSelect>
                  <FormSelect name={`crew_${s.id}`} defaultValue={String(s.crewSize)} aria-label={`How many cleaners ${s.name} needs`} className="w-full sm:w-36">
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? "1 cleaner" : `${n} cleaners`}
                      </option>
                    ))}
                  </FormSelect>
                </li>
              ))}
            </ul>
          )}
        </div>

        <FormField label="Link name" htmlFor="name" hint="Changing it changes your link.">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-sm text-muted-foreground">{host(site)}/book/</span>
            <Input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="min-w-0" />
          </div>
        </FormField>
        {renaming && (
          <p className={problem ? "text-xs text-destructive" : "text-xs text-amber-700 dark:text-amber-400"}>
            {problem ??
              `Your link will change to ${host(site)}/book/${tidy}. The old link will stop working, so you will need to update it anywhere you shared it.`}
          </p>
        )}

        <div className="flex justify-end">
          <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
        </div>
      </form>
    </div>
  );
}
