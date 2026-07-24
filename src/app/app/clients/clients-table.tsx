"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarPlus, Mail, MessageSquare, Ban, Settings2 } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrencyCents } from "@/lib/format";

export type ClientRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  balance_cents: number;
  preferred_contact: string;
  contact_preference: string | null;
  sms_opted_in: boolean | null;
  created_at: string;
};

const DEFAULT_LABEL: Record<string, string> = {
  email: "Email",
  sms: "Text",
  both: "Email + text",
  none: "Silent",
};

export function ClientsTable({
  rows,
  // Reserved for row-level edit affordances; currently unused.
  canEdit: _canEdit,
  orgContactDefault = "email",
}: {
  rows: ClientRow[];
  canEdit: boolean;
  /** The org's house default — shown for clients that follow it. */
  orgContactDefault?: string;
}) {
  const router = useRouter();
  const columns: DataTableColumn<ClientRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (r) => <span className="font-medium">{r.name}</span>,
      searchValue: (r) => r.name,
    },
    {
      key: "email",
      header: "Email",
      render: (r) => (
        <span className="text-muted-foreground">{r.email ?? "—"}</span>
      ),
      searchValue: (r) => r.email,
    },
    {
      key: "phone",
      header: "Phone",
      render: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {r.phone ?? "—"}
        </span>
      ),
      searchValue: (r) => r.phone,
    },
    {
      // At-a-glance notification state so "who's silent / who's custom" is
      // scannable across the whole list without opening each client.
      key: "notifications",
      header: "Notifications",
      render: (r) => {
        const pref = r.contact_preference ?? "inherit";
        if (pref === "do_not_contact") {
          return (
            <StatusBadge tone="red">
              <Ban className="mr-1 h-3 w-3" />
              No contact
            </StatusBadge>
          );
        }
        if (pref === "custom") {
          return (
            <StatusBadge tone="blue">
              <Settings2 className="mr-1 h-3 w-3" />
              Custom
            </StatusBadge>
          );
        }
        // Follows the org default — show what that actually means, with a
        // subtle marker when texts are wanted but the client isn't opted in.
        const wantsSms =
          orgContactDefault === "sms" || orgContactDefault === "both";
        const smsBlocked = wantsSms && !r.sms_opted_in;
        return (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            {orgContactDefault === "none" ? (
              <Ban className="h-3 w-3" />
            ) : orgContactDefault === "sms" ? (
              <MessageSquare className="h-3 w-3" />
            ) : (
              <Mail className="h-3 w-3" />
            )}
            {DEFAULT_LABEL[orgContactDefault] ?? "Email"}
            {smsBlocked && (
              <span title="Texts selected but this client hasn't opted in to SMS">
                ⚠
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "balance",
      header: "Balance",
      headerClassName: "text-right",
      className: "text-right tabular-nums font-medium",
      render: (r) => formatCurrencyCents(r.balance_cents),
    },
    {
      key: "actions",
      header: "",
      headerClassName: "w-10",
      className: "w-10 text-right",
      render: (r) => (
        <Link
          href={`/app/bookings/new?client_id=${r.id}`}
          onClick={(e) => e.stopPropagation()}
          title="New booking for this client"
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <CalendarPlus className="h-3.5 w-3.5" />
          Book
        </Link>
      ),
    },
  ];

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      searchPlaceholder="Search clients by name, email, or phone…"
      onRowClick={(r) => router.push(`/app/clients/${r.id}`)}
      emptyState={{
        title: "No clients yet",
        description: "Add your first client with the New client button.",
      }}
    />
  );
}
