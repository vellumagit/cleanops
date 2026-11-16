/**
 * Messages that must go once, when two runs overlap.
 *
 * Vercel can start a cron again while the last run is still going (a slow
 * minute, a retry). On a real server (vitest.load.config.ts), two auto-send
 * runs at the same moment must still email each due invoice once. Email is
 * stood in for: sending "succeeds" and records the recipient.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "../db/api";
import { addClient, addOrg } from "../db/harness";
import { hasRealPostgres } from "../db/real-postgres";

const sentEmails: Array<{ to: string }> = [];
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  isEmailConfigured: () => true,
  sendOrgEmailDetailed: async (_org: string, message: { to: string }) => {
    sentEmails.push({ to: message.to });
    // A real send takes a moment; long enough for the other run to look.
    await new Promise((r) => setTimeout(r, 50));
    return { ok: true, id: "test-message" };
  },
}));

const ready = hasPostgrest && hasRealPostgres;
let api: Api;
let restoreEnv: () => void;

beforeAll(async () => {
  if (!ready) return;
  api = await startApi();
  if (api.kind !== "postgres") throw new Error("the load tests must run on a real server (pnpm test:load)");
  restoreEnv = api.useAsSupabase();
});

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

describe.skipIf(!ready)("sends that must go once, on a real server", () => {
  it("two invoice auto-send runs at the same moment: each of ten due invoices is emailed once", async () => {
    const { runInvoiceAutoSend } = await import("@/lib/invoice-send");
    const org = await addOrg(api.sql, "Twice Co");
    await api.sql("update public.organizations set timezone = 'UTC', automations_enabled = true, invoice_auto_send_enabled = true where id = $1", [org]);
    const emails: string[] = [];
    for (let i = 0; i < 10; i++) {
      const client = await addClient(api.sql, org, `Twice ${i}`);
      const email = `twice-${i}-${client.slice(0, 6)}@example.test`;
      emails.push(email);
      await api.sql("update public.clients set email = $2 where id = $1", [client, email]);
      await api.sql(
        `insert into public.invoices (organization_id, client_id, status, amount_cents, due_date, auto_send_state, auto_send_at)
         values ($1, $2, 'draft', 14000, current_date + 14, 'scheduled', now() - interval '5 minutes')`,
        [org, client],
      );
    }
    sentEmails.length = 0;
    await Promise.all([runInvoiceAutoSend(), runInvoiceAutoSend()]);
    const counts = emails.map((e) => sentEmails.filter((s) => s.to === e).length);
    expect(counts, "emails per invoice").toEqual(emails.map(() => 1));
    const [{ sent }] = await api.sql<{ sent: number }>("select count(*)::int as sent from public.invoices where organization_id = $1 and status = 'sent'", [org]);
    expect(sent).toBe(10);
  });
});
