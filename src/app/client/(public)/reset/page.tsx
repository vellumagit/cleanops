import { ClientResetForm } from "./reset-form";

export const metadata = { title: "Set a new password" };

export default function ClientResetPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 text-center">
          <h1 className="text-xl font-bold">Set a new password</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Pick something you&rsquo;ll remember — or skip passwords entirely
            and use the emailed sign-in link next time.
          </p>
        </div>
        <ClientResetForm />
      </div>
    </div>
  );
}
