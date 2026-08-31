import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { NetworkContactForm } from "../network-form";

export const metadata = { title: "Add network contact" };

export default async function NewNetworkContactPage() {
  await requireMembership(["owner", "admin", "manager"]);

  return (
    <PageShell
      title="Add contact"
      description="Someone worth keeping on speed dial."
      actions={
        <Link
          href="/app/network"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ChevronLeft className="h-4 w-4" />
          Network
        </Link>
      }
    >
      <div className="max-w-2xl rounded-lg border border-border bg-card p-6">
        <NetworkContactForm mode="create" />
      </div>
    </PageShell>
  );
}
