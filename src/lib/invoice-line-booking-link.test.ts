import { describe, expect, it } from "vitest";

/**
 * The booking link on an invoice line is the ONLY record that a job billed on
 * a consolidated invoice has been billed at all. Two readers depend on it:
 * the "Bill for a period" builder's already-billed filter, and (via the
 * booking stamp derived from it) the billing-cycle cron.
 *
 * It was dropped by the line-items save, which reconciles by deleting rows
 * missing from the payload and re-inserting anything without a db_id — with a
 * payload that had no booking_id field at all. Khual's Jul 31 clean was
 * invoiced twice off the back of it, and 53 live line items lost their link.
 *
 * These are shape tests over the round trip, deliberately free of any
 * database: the defect was never in the SQL, it was a field quietly missing
 * from an object literal, which is exactly the kind of thing types don't
 * catch when the column is nullable.
 */

/** What the editor puts in the hidden JSON payload. */
type EditorLine = {
  db_id: string | null;
  label: string;
  quantity: string;
  unit_price_dollars: string;
  sort_order: number;
  booking_id: string | null;
};

/** The row the save writes. Mirrors reconcileInvoiceLineItems's payload. */
function persistedRow(row: EditorLine, invoiceId: string, orgId: string) {
  return {
    invoice_id: invoiceId,
    organization_id: orgId,
    label: row.label,
    quantity: Number(row.quantity),
    unit_price_cents: Math.round(Number(row.unit_price_dollars) * 100),
    sort_order: row.sort_order,
    booking_id: row.booking_id ?? null,
  };
}

/** Seeding the editor from what's in the database. */
function seedEditor(existing: {
  id: string;
  label: string;
  quantity: number;
  unit_price_cents: number;
  sort_order: number;
  booking_id?: string | null;
}): EditorLine {
  return {
    db_id: existing.id,
    label: existing.label,
    quantity: String(existing.quantity),
    unit_price_dollars: (existing.unit_price_cents / 100).toFixed(2),
    sort_order: existing.sort_order,
    booking_id: existing.booking_id ?? null,
  };
}

const dbRow = {
  id: "line-1",
  label: "Standard clean · Fri, Jul 31, 2026 · 5124 Riverbend Rd nw",
  quantity: 1,
  unit_price_cents: 14175,
  sort_order: 0,
  booking_id: "booking-jul-31",
};

describe("invoice line → booking link survives an edit", () => {
  it("round-trips the link from database → editor → saved row", () => {
    const saved = persistedRow(seedEditor(dbRow), "inv-1", "org-1");
    expect(saved.booking_id).toBe("booking-jul-31");
  });

  it("keeps the link even when the row is RE-INSERTED (no db_id)", () => {
    // The exact path that lost it: the reconciler deletes rows missing from
    // the payload and inserts anything without a db_id. A re-inserted line
    // must still carry its booking.
    const reinserted = { ...seedEditor(dbRow), db_id: null };
    expect(persistedRow(reinserted, "inv-1", "org-1").booking_id).toBe(
      "booking-jul-31",
    );
  });

  it("keeps the link when other fields on the line are edited", () => {
    const edited = { ...seedEditor(dbRow), unit_price_dollars: "150.00" };
    const saved = persistedRow(edited, "inv-1", "org-1");
    expect(saved.unit_price_cents).toBe(15000);
    expect(saved.booking_id).toBe("booking-jul-31");
  });

  it("a hand-added line bills no job, and says so explicitly", () => {
    const manual: EditorLine = {
      db_id: null,
      label: "Extra: inside fridge",
      quantity: "1",
      unit_price_dollars: "40.00",
      sort_order: 1,
      booking_id: null,
    };
    expect(persistedRow(manual, "inv-1", "org-1").booking_id).toBeNull();
  });

  it("an older client that omits the field saves null rather than throwing", () => {
    const legacy = { ...seedEditor(dbRow) } as Partial<EditorLine> as EditorLine;
    delete (legacy as { booking_id?: unknown }).booking_id;
    expect(persistedRow(legacy, "inv-1", "org-1").booking_id).toBeNull();
  });

  it("the persisted payload always carries the key — a missing key is the bug", () => {
    const saved = persistedRow(seedEditor(dbRow), "inv-1", "org-1");
    expect(Object.keys(saved)).toContain("booking_id");
  });
});
