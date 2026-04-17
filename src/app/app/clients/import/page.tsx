import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import clients" };

export default async function ImportClientsPage() {
  await requireMembership(["owner", "admin"]);

  return (
    <PageShell
      title="Import clients from CSV"
      description="Bulk-add clients from a spreadsheet. Duplicates are skipped automatically."
      actions={
        <Link
          href="/app/clients"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to clients
        </Link>
      }
    >
      <div className="max-w-2xl space-y-6">
        <div className="rounded-lg border border-border bg-card p-5 text-sm">
          <h2 className="font-medium">Expected columns</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Your CSV needs a header row. <strong>name</strong> is required;
            everything else is optional.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-2 pr-3 font-medium">Column</th>
                  <th className="pb-2 pr-3 font-medium">Required</th>
                  <th className="pb-2 font-medium">Example</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-muted-foreground">
                <tr>
                  <td className="py-1.5 pr-3 font-mono text-foreground">name</td>
                  <td className="py-1.5 pr-3 text-red-600 dark:text-red-400">yes</td>
                  <td className="py-1.5">Jane Smith</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 font-mono text-foreground">email</td>
                  <td className="py-1.5 pr-3">no</td>
                  <td className="py-1.5">jane@example.com</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 font-mono text-foreground">phone</td>
                  <td className="py-1.5 pr-3">no</td>
                  <td className="py-1.5">+1 416 555 1234</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 font-mono text-foreground">address</td>
                  <td className="py-1.5 pr-3">no</td>
                  <td className="py-1.5">123 Main St, Toronto</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 font-mono text-foreground">preferred_contact</td>
                  <td className="py-1.5 pr-3">no</td>
                  <td className="py-1.5">email / phone / sms</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3 font-mono text-foreground">notes</td>
                  <td className="py-1.5 pr-3">no</td>
                  <td className="py-1.5">Prefers weekend cleans</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Column names are matched case-insensitively. Aliases like{" "}
            <code>full_name</code>, <code>email_address</code>,{" "}
            <code>mobile</code> also work.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <ImportForm />
        </div>
      </div>
    </PageShell>
  );
}
