import { redirect } from "next/navigation";

/**
 * The old "Automation thresholds" page. Its five timing settings now sit
 * beside the switches they time (2026-11-21): estimate expiry, auto-complete
 * and auto-archive on Team alerts & housekeeping, auto-void on Invoicing,
 * overtime on Payroll & timesheets. Kept as a redirect rather than deleted —
 * the address has been live and is in people's bookmarks.
 */
export default function LegacyThresholdsRedirect() {
  redirect("/app/settings/team-alerts");
}
