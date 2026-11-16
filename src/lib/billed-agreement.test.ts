import { describe, expect, it } from "vitest";
import { billedAgreementLines, billedDisagreements } from "./billed-agreement";

const inv = (id: string, status = "sent", booking_id: string | null = null) => ({
  id,
  number: `INV-${id}`,
  status,
  booking_id,
});

describe("do the records of what is billed agree?", () => {
  it("a line and a stamp pointing at the same invoice agree", () => {
    const r = billedDisagreements([inv("a")], [{ invoice_id: "a", booking_id: "job1" }], [{ id: "job1", billing_invoice_id: "a" }]);
    expect(r).toEqual({ billedJobs: 1, found: [] });
  });

  it("a single-job invoice's own column counts as a link", () => {
    const r = billedDisagreements([inv("a", "paid", "job1")], [], [{ id: "job1", billing_invoice_id: "a" }]);
    expect(r.found).toEqual([]);
  });

  it("a live invoice names the job and the job carries no stamp", () => {
    const r = billedDisagreements([inv("a", "paid", "job1")], [], []);
    expect(r.found).toEqual([{ kind: "no_stamp", jobId: "job1", invoices: ["INV-a"] }]);
  });

  it("a stamp with no link is not a disagreement: old invoices list jobs as typed text", () => {
    const r = billedDisagreements([inv("a")], [], [{ id: "job1", billing_invoice_id: "a" }]);
    expect(r).toEqual({ billedJobs: 1, found: [] });
  });

  it("Carmen's June visit: paid on one invoice, stamped onto a draft made later", () => {
    const r = billedDisagreements(
      [inv("0012", "paid", "jun9"), inv("0023", "draft")],
      [],
      [{ id: "jun9", billing_invoice_id: "0023" }],
    );
    expect(r.found).toEqual([{ kind: "two_invoices", jobId: "jun9", invoices: ["INV-0012", "INV-0023"] }]);
  });

  it("two live invoices each with a line for the same job", () => {
    const r = billedDisagreements(
      [inv("a"), inv("b")],
      [
        { invoice_id: "a", booking_id: "job1" },
        { invoice_id: "b", booking_id: "job1" },
      ],
      [{ id: "job1", billing_invoice_id: "a" }],
    );
    expect(r.found.map((f) => f.kind)).toEqual(["two_invoices"]);
  });

  it("a void invoice claims nothing, by link or by stamp", () => {
    const r = billedDisagreements(
      [inv("a", "paid"), inv("v", "void", "job1")],
      [
        { invoice_id: "a", booking_id: "job1" },
        { invoice_id: "v", booking_id: "job1" },
      ],
      [{ id: "job1", billing_invoice_id: "a" }, { id: "job2", billing_invoice_id: "v" }],
    );
    expect(r).toEqual({ billedJobs: 1, found: [] });
  });

  it("the dangerous kind is listed first, and the report names the invoices to open", () => {
    const r = billedDisagreements(
      [inv("a", "paid", "job1"), inv("b", "paid", "job2"), inv("c", "draft")],
      [],
      [{ id: "job2", billing_invoice_id: "c" }],
    );
    expect(r.found.map((f) => f.kind)).toEqual(["two_invoices", "no_stamp"]);
    const lines = billedAgreementLines(r);
    expect(lines[0]).toMatch(/1 {2}job\(s\) claimed by two live invoices.*INV-b \+ INV-c/);
    expect(lines[1]).toMatch(/1 {2}job\(s\) on a live invoice with no stamp.*INV-a/);
  });

  it("a clean company prints two zero lines", () => {
    const lines = billedAgreementLines({ billedJobs: 5, found: [] });
    expect(lines.map((l) => l.trim())).toEqual([
      "0  job(s) claimed by two live invoices",
      "0  job(s) on a live invoice with no stamp on the job",
    ]);
  });
});
