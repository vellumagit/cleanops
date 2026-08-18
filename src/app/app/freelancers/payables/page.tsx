import { redirect } from "next/navigation";

/**
 * Subcontractor pay moved to /app/payroll/contractors.
 *
 * It used to live here, under the On-call pool, which filed a PAYING concept
 * inside a SOURCING one. A roster subcontractor who has never been near the
 * bench still had their pay sitting under "who can I text tonight" — and at
 * Svit that was 11 of 13 people, hidden two clicks inside a recruiting tool
 * while Payroll's front page showed pay periods for the 2 employees.
 *
 * Kept as a redirect rather than deleted: this path has been live, and an
 * emailed link or a bookmark should land somewhere useful rather than 404.
 */
export default function LegacyPayablesRedirect() {
  redirect("/app/payroll/contractors");
}
