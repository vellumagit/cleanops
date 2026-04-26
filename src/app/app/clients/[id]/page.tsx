import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Mail,
  Phone,
  MapPin,
  Star,
  Calendar,
  FileText,
  ChevronLeft,
  Pencil,
  Receipt,
  ClipboardList,
} from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import {
  StatusBadge,
  bookingStatusTone,
  invoiceStatusTone,
  estimateStatusTone,
} from "@/components/status-badge";
import {
  formatDateTime,
  formatCurrencyCents,
  humanizeEnum,
  formatDurationMinutes,
} from "@/lib/format";
import { getOrgCurrency } from "@/lib/org-currency";
import { PortalInviteButton } from "./portal-invite-button";

export const metadata = { title: "Client" };

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const membership = await requireMembership();
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const currency = await getOrgCurrency(membership.organization_id);

  const [
    clientResult,
    bookingsResult,
    invoicesResult,
    estimatesResult,
    reviewsResult,
  ] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, email, phone, address, notes, preferred_contact, balance_cents, created_at, profile_id, portal_invited_at, portal_accepted_at, portal_invite_expires_at")
      .eq("id", id)
      .maybeSingle() as unknown as Promise<{
      data: {
        id: string;
        name: string;
        email: string | null;
        phone: string | null;
        address: string | null;
        notes: string | null;
        preferred_contact: string;
        balance_cents: number;
        created_at: string;
        profile_id: string | null;
        portal_invited_at: string | null;
        portal_accepted_at: string | null;
        portal_invite_expires_at: string | null;
      } | null;
      error: { message: string } | null;
    }>,

    supabase
      .from("bookings")
      .select("id, scheduled_at, duration_minutes, status, service_type, address")
      .eq("client_id", id)
      .order("scheduled_at", { ascending: false })
      .limit(10),

    supabase
      .from("invoices")
      .select("id, number, status, amount_cents, due_date, issued_at")
      .eq("client_id", id)
      .order("issued_at", { ascending: false })
      .limit(10) as unknown as Promise<{
      data: Array<{
        id: string;
        number: number;
        status: string;
        amount_cents: number;
        due_date: string | null;
        issued_at: string | null;
      }> | null;
      error: unknown;
    }>,

    supabase
      .from("estimates")
      .select("id, status, total_cents, service_description, created_at")
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .limit(10) as unknown as Promise<{
      data: Array<{
        id: string;
        status: string;
        total_cents: number;
        service_description: string | null;
        created_at: string;
      }> | null;
      error: unknown;
    }>,

    supabase
      .from("reviews")
      .select("id, rating, comment, created_at")
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const { data: client, error } = clientResult;
  if (error) throw error;
  if (!client) notFound();

  const bookings = bookingsResult.data ?? [];
  const invoices = invoicesResult.data ?? [];
  const estimates = estimatesResult.data ?? [];
  const reviews = reviewsResult.data ?? [];

  const canEdit =
    membership.role === "owner" ||
    membership.role === "admin" ||
    membership.role === "manager";

  return (
    <PageShell
      title={client.name}
      description="Client overview"
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/app/clients"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Clients
          </Link>
          <Link
            href={`/app/clients/${id}/statement`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <FileText className="h-3.5 w-3.5" />
            Statement
          </Link>
          {(membership.role === "owner" || membership.role === "admin") && (
            <PortalInviteButton
              clientId={client.id}
              clientEmail={client.email}
              hasPortalAccess={Boolean(client.profile_id)}
              portalInvitedAt={client.portal_invited_at}
              portalInviteExpiresAt={client.portal_invite_expires_at}
            />
          )}
          {canEdit && (
            <Link
              href={`/app/clients/${id}/edit`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Link>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        {/* ── Client info card ── */}
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5">
              <h2 className="text-lg font-bold">{client.name}</h2>
              {client.email && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  <a
                    href={`mailto:${client.email}`}
                    className="hover:text-foreground hover:underline underline-offset-2"
                  >
                    {client.email}
                  </a>
                </p>
              )}
              {client.phone && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Phone className="h-3.5 w-3.5 shrink-0" />
                  <a
                    href={`tel:${client.phone}`}
                    className="hover:text-foreground hover:underline underline-offset-2"
                  >
                    {client.phone}
                  </a>
                </p>
              )}
              {client.address && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  {client.address}
                </p>
              )}
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2 text-right">
              <div>
                <p className="text-xs text-muted-foreground">Balance owing</p>
                <p
                  className={`text-lg font-bold tabular-nums ${
                    client.balance_cents > 0 ? "text-rose-600" : "text-foreground"
                  }`}
                >
                  {formatCurrencyCents(client.balance_cents, currency)}
                </p>
              </div>
              <StatusBadge tone="neutral">
                Prefers {humanizeEnum(client.preferred_contact)}
              </StatusBadge>
            </div>
          </div>

          {client.notes && (
            <div className="mt-4 rounded-md bg-muted/40 px-3 py-2">
              <p className="text-xs font-semibold text-muted-foreground">Notes</p>
              <p className="mt-0.5 text-sm">{client.notes}</p>
            </div>
          )}

          <p className="mt-3 text-[11px] text-muted-foreground">
            Client since{" "}
            {new Date(client.created_at).toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>

        {/* ── Stats row ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Bookings", value: bookings.length, icon: Calendar, href: `/app/bookings?client=${id}` },
            { label: "Invoices", value: invoices.length, icon: Receipt, href: `/app/invoices?client=${id}` },
            { label: "Estimates", value: estimates.length, icon: ClipboardList, href: `/app/estimates?client=${id}` },
            { label: "Reviews", value: reviews.length, icon: Star, href: undefined },
          ].map(({ label, value, icon: Icon, href }) => {
            const inner = (
              <>
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-2xl font-bold tabular-nums">{value}</span>
                <span className="text-xs text-muted-foreground">{label}</span>
              </>
            );
            return href ? (
              <Link
                key={label}
                href={href}
                className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-4 text-center transition-colors hover:bg-muted/50"
              >
                {inner}
              </Link>
            ) : (
              <div
                key={label}
                className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-4 text-center"
              >
                {inner}
              </div>
            );
          })}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* ── Bookings ── */}
          <Section
            title="Recent bookings"
            emptyText="No bookings yet."
            viewAllHref={`/app/bookings`}
          >
            {bookings.map((b) => (
              <Link
                key={b.id}
                href={`/app/bookings/${b.id}`}
                className="flex items-start justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {humanizeEnum(b.service_type)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(b.scheduled_at)}
                    {b.duration_minutes
                      ? ` · ${formatDurationMinutes(b.duration_minutes)}`
                      : ""}
                  </p>
                </div>
                <StatusBadge
                  tone={bookingStatusTone(
                    b.status as
                      | "pending"
                      | "confirmed"
                      | "en_route"
                      | "in_progress"
                      | "completed"
                      | "cancelled",
                  )}
                >
                  {humanizeEnum(b.status)}
                </StatusBadge>
              </Link>
            ))}
          </Section>

          {/* ── Invoices ── */}
          <Section
            title="Recent invoices"
            emptyText="No invoices yet."
            viewAllHref={`/app/invoices`}
          >
            {invoices.map((inv) => (
              <Link
                key={inv.id}
                href={`/app/invoices/${inv.id}`}
                className="flex items-start justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    INV-{String(inv.number).padStart(3, "0")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatCurrencyCents(inv.amount_cents, currency)}
                    {inv.due_date
                      ? ` · Due ${new Date(inv.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                      : ""}
                  </p>
                </div>
                <StatusBadge
                  tone={invoiceStatusTone(
                    inv.status as
                      | "draft"
                      | "sent"
                      | "partially_paid"
                      | "paid"
                      | "overdue"
                      | "void",
                  )}
                >
                  {humanizeEnum(inv.status)}
                </StatusBadge>
              </Link>
            ))}
          </Section>

          {/* ── Estimates ── */}
          <Section
            title="Recent estimates"
            emptyText="No estimates yet."
            viewAllHref={`/app/estimates`}
          >
            {estimates.map((est) => (
              <Link
                key={est.id}
                href={`/app/estimates/${est.id}/edit`}
                className="flex items-start justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {est.service_description ?? "Estimate"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatCurrencyCents(est.total_cents, currency)} ·{" "}
                    {new Date(est.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <StatusBadge
                  tone={estimateStatusTone(
                    est.status as
                      | "draft"
                      | "sent"
                      | "approved"
                      | "declined"
                      | "expired",
                  )}
                >
                  {humanizeEnum(est.status)}
                </StatusBadge>
              </Link>
            ))}
          </Section>

          {/* ── Reviews ── */}
          <Section
            title="Reviews"
            emptyText="No reviews yet."
          >
            {reviews.map((rev) => (
              <div
                key={rev.id}
                className="rounded-md px-2 py-2"
              >
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      className={`h-3.5 w-3.5 ${
                        s <= (rev.rating ?? 0)
                          ? "fill-amber-400 text-amber-400"
                          : "fill-muted text-muted"
                      }`}
                    />
                  ))}
                  <span className="ml-1 text-xs text-muted-foreground">
                    {new Date(rev.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
                {rev.comment && (
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-3">
                    {rev.comment}
                  </p>
                )}
              </div>
            ))}
          </Section>
        </div>
      </div>
    </PageShell>
  );
}

function Section({
  title,
  emptyText,
  viewAllHref,
  children,
}: {
  title: string;
  emptyText: string;
  viewAllHref?: string;
  children: React.ReactNode;
}) {
  const hasItems = Array.isArray(children)
    ? children.filter(Boolean).length > 0
    : Boolean(children);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            View all →
          </Link>
        )}
      </div>
      {hasItems ? (
        <div className="divide-y divide-border/50">{children}</div>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      )}
    </div>
  );
}
