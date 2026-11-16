/**
 * Invoice auto-send (runInvoiceAutoSend, the invoice-auto-send cron),
 * against a real database behind the real PostgREST.
 *
 * What it owes the client: a draft scheduled to go goes once, to the
 * client's address, when it is due; one not yet due, one a person put on
 * hold, and one at a company that turned auto-send off do not go at all.
 * Email is stood in for: sending "succeeds" and records the recipient.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addOrg } from "./harness";

const sentEmails: Array<{ to: string }> = [];
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  isEmailConfigured: () => true,
  sendOrgEmailDetailed: async (_org: string, message: { to: string }) => {
    sentEmails.push({ to: message.to });
    return { ok: true, id: "test-message" };
  },
}));

let api: Api;
let restoreEnv: () => void;

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

async function company(autoSend = true) {
  const org = await addOrg(api.sql, "AutoSend Co");
  await api.sql(
    "update public.organizations set timezone = 'UTC', automations_enabled = true, invoice_auto_send_enabled = $2 where id = $1",
    [org, autoSend],
  );
  const client = await addClient(api.sql, org);
  const email = `auto-${client.slice(0, 8)}@example.test`;
  await api.sql("update public.clients set email = $2 where id = $1", [client, email]);
  return { org, client, email };
}

async function draft(c: { org: string; client: string }, opts: { dueMinutesAgo?: number; state?: string } = {}) {
  const [inv] = await api.sql<{ id: string }>(
    `insert into public.invoices (organization_id, client_id, status, amount_cents, due_date, auto_send_state, auto_send_at)
     values ($1, $2, 'draft', 14000, current_date + 14, $3, now() - make_interval(mins => $4)) returning id`,
    [c.org, c.client, opts.state ?? "scheduled", opts.dueMinutesAgo ?? 5],
  );
  return inv.id;
}

const state = async (id: string) =>
  (
    await api.sql<{ status: string; auto: string | null }>(
      "select status::text as status, auto_send_state as auto from public.invoices where id = $1",
      [id],
    )
  )[0];

describe.skipIf(!hasPostgrest)("invoice auto-send", () => {
  it("a due draft goes once, to the client; one not yet due, one on hold, and one where auto-send is off stay put", async () => {
    const { runInvoiceAutoSend } = await import("@/lib/invoice-send");
    const on = await company(true);
    const off = await company(false);
    const due = await draft(on);
    const later = await draft(on, { dueMinutesAgo: -60 });
    const held = await draft(on, { state: "held" });
    const disabled = await draft(off);
    sentEmails.length = 0;

    await runInvoiceAutoSend();
    expect(await state(due)).toMatchObject({ status: "sent" });
    expect(sentEmails.filter((e) => e.to === on.email)).toHaveLength(1);
    for (const id of [later, held, disabled]) expect((await state(id)).status, `invoice ${id.slice(0, 8)}`).toBe("draft");
    expect(sentEmails.some((e) => e.to === off.email)).toBe(false);

    // A second run the same minute sends nothing again.
    await runInvoiceAutoSend();
    expect(sentEmails.filter((e) => e.to === on.email)).toHaveLength(1);
  });
});
