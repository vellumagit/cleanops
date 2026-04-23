import { ClaimForm } from "./claim-form";

export const metadata = { title: "Set up your account" };

export default async function ClaimPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 text-center">
          <h1 className="text-xl font-bold">Set up your account</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Pick a password to finish claiming your client portal access.
          </p>
        </div>
        <ClaimForm token={token} />
      </div>
    </div>
  );
}
