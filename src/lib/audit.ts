/**
 * Audit log helper.
 *
 * Every sensitive mutation in the ops console should call `logAuditEvent`
 * after the underlying write succeeds. The `audit_log` table is append-only
 * (no UPDATE / DELETE policy) so once a row is written it sticks.
 *
 * RLS on `audit_log`:
 *   - INSERT: any active member of the org may write
 *   - SELECT: owner / admin only
 *   - no UPDATE, no DELETE
 *
 * The helper deliberately swallows errors so a logging failure can never
 * undo a real mutation. We log to the server console instead — Sentry
 * picks those up in production.
 */

import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentMembership } from "@/lib/auth";

export type AuditEntity =
  | "client"
  | "employee"
  | "package"
  | "booking"
  | "estimate"
  | "contract"
  | "invoice"
  | "review"
  | "training_module"
  | "training_assignment"
  | "inventory_item"
  | "bonus"
  | "bonus_rule"
  | "membership"
  | "settings"
  | "api_key"
  | "time_entry"
  | "webhook_subscription";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "status_change"
  | "convert"
  | "mark_paid"
  | "assign"
  | "invite"
  | "deactivate"
  | "revoke";

type LogArgs = {
  membership: CurrentMembership;
  action: AuditAction;
  entity: AuditEntity;
  entity_id?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

/**
 * Append a single audit event. Never throws — failures are logged.
 *
 * Uses the caller's RLS-bound server client so the row is correctly
 * attributed to the current actor and constrained to their org.
 */
export async function logAuditEvent(args: LogArgs): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("audit_log").insert({
      organization_id: args.membership.organization_id,
      actor_id: args.membership.id,
      action: args.action,
      entity: args.entity,
      entity_id: args.entity_id ?? null,
      before: (args.before ?? null) as never,
      after: (args.after ?? null) as never,
    });
    if (error) {
      console.error("[audit] insert failed:", error.message, {
        action: args.action,
        entity: args.entity,
      });
    }
  } catch (err) {
    console.error("[audit] unexpected failure:", err);
  }
}
