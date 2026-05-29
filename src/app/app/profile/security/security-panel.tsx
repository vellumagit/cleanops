"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Shield,
  ShieldCheck,
  ShieldOff,
  QrCode,
  KeyRound,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Factor = {
  id: string;
  status: string;
  friendlyName: string;
  createdAt: string | null;
};

export function SecurityPanel({ factors }: { factors: Factor[] }) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  const verified = factors.filter((f) => f.status === "verified");
  const unverified = factors.filter((f) => f.status !== "verified");
  const hasVerified = verified.length > 0;

  // Enrollment flow state. enrollmentData is set after we call
  // mfa.enroll — it carries the QR code + secret + factorId. We then
  // ask the user to enter their first TOTP code to verify.
  const [enrollmentData, setEnrollmentData] = useState<{
    factorId: string;
    qrCodeSvg: string;
    secret: string;
  } | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [pending, setPending] = useState(false);

  async function startEnrollment() {
    setPending(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator (${new Date().toLocaleDateString()})`,
      });
      if (error) throw error;
      if (!data) throw new Error("Enrollment returned no data");
      setEnrollmentData({
        factorId: data.id,
        qrCodeSvg: data.totp.qr_code,
        secret: data.totp.secret,
      });
      setVerifyCode("");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not start MFA enrollment",
      );
    } finally {
      setPending(false);
    }
  }

  async function verifyEnrollment() {
    if (!enrollmentData) return;
    if (!/^\d{6}$/.test(verifyCode)) {
      toast.error("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setPending(true);
    try {
      const { data: challengeData, error: challengeErr } =
        await supabase.auth.mfa.challenge({
          factorId: enrollmentData.factorId,
        });
      if (challengeErr) throw challengeErr;

      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId: enrollmentData.factorId,
        challengeId: challengeData!.id,
        code: verifyCode,
      });
      if (verifyErr) throw verifyErr;

      toast.success("Multi-factor authentication enabled.");
      setEnrollmentData(null);
      setVerifyCode("");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not verify the code. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  async function cancelEnrollment() {
    if (!enrollmentData) return;
    // Unenroll the half-created factor so it doesn't linger as
    // "unverified" on the account.
    try {
      await supabase.auth.mfa.unenroll({
        factorId: enrollmentData.factorId,
      });
    } catch {
      // Best effort — even if cleanup fails, drop the UI state.
    }
    setEnrollmentData(null);
    setVerifyCode("");
  }

  async function removeFactor(factorId: string) {
    if (
      !confirm(
        "Remove this authenticator? You'll be able to sign in with just your password again until you set up MFA again.",
      )
    ) {
      return;
    }
    setPending(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      toast.success("Multi-factor authentication removed.");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not remove the factor.",
      );
    } finally {
      setPending(false);
    }
  }

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------

  return (
    <div className="max-w-2xl space-y-6">
      {/* Status card */}
      <div
        className={`rounded-xl border p-5 ${
          hasVerified
            ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/30"
            : "border-border bg-card"
        }`}
      >
        <div className="flex items-start gap-3">
          {hasVerified ? (
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Shield className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          )}
          <div className="flex-1">
            <h2 className="text-sm font-semibold">
              {hasVerified
                ? "Multi-factor authentication is ON"
                : "Multi-factor authentication is OFF"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {hasVerified
                ? "When you sign in, you'll be asked for a 6-digit code from your authenticator app in addition to your password."
                : "Add a one-time code from an authenticator app (Authy, Google Authenticator, 1Password, etc.) as a second factor when signing in. It's optional but recommended for owners and admins."}
            </p>
          </div>
        </div>
      </div>

      {/* Mid-enrollment: QR code + verify step */}
      {enrollmentData && (
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <QrCode className="h-4 w-4" />
            Step 1 — Scan this QR code
          </div>
          <p className="text-xs text-muted-foreground">
            Open your authenticator app (Authy, Google Authenticator,
            1Password, Microsoft Authenticator, etc.) and add a new account
            by scanning this code.
          </p>
          <div
            className="flex justify-center rounded-md border border-border bg-white p-4"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: enrollmentData.qrCodeSvg }}
          />
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Can&apos;t scan? Enter the code manually
            </summary>
            <div className="mt-2 rounded-md bg-muted px-3 py-2 font-mono text-xs">
              {enrollmentData.secret}
            </div>
          </details>

          <div className="space-y-2 border-t border-border pt-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="h-4 w-4" />
              Step 2 — Enter the 6-digit code
            </div>
            <Label htmlFor="totp-code" className="text-xs">
              Code from your authenticator app
            </Label>
            <Input
              id="totp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="\d{6}"
              value={verifyCode}
              onChange={(e) =>
                setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="123456"
              className="font-mono text-center text-lg tracking-widest"
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={cancelEnrollment}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={verifyEnrollment}
                disabled={pending || verifyCode.length !== 6}
              >
                {pending ? "Verifying…" : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Active factors list */}
      {verified.length > 0 && !enrollmentData && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">Active authenticators</h2>
          <ul className="space-y-2">
            {verified.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-medium">{f.friendlyName}</div>
                  {f.createdAt && (
                    <div className="text-xs text-muted-foreground">
                      Added{" "}
                      {new Date(f.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeFactor(f.id)}
                  disabled={pending}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Cleanup: half-enrolled factors (status=unverified) */}
      {unverified.length > 0 && !enrollmentData && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs dark:border-amber-900/40 dark:bg-amber-950/30">
          <div className="mb-2 flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-200">
            <ShieldOff className="h-4 w-4" />
            {unverified.length} unverified factor
            {unverified.length === 1 ? "" : "s"} cluttering your account
          </div>
          <ul className="space-y-2">
            {unverified.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-white/70 px-3 py-1.5 dark:border-amber-900/40 dark:bg-black/20"
              >
                <span>{f.friendlyName}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeFactor(f.id)}
                  disabled={pending}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Enable button (when no enrollment in progress and not already enrolled) */}
      {!hasVerified && !enrollmentData && (
        <div>
          <Button onClick={startEnrollment} disabled={pending}>
            <Shield className="h-4 w-4" />
            {pending ? "Setting up…" : "Enable multi-factor authentication"}
          </Button>
        </div>
      )}
    </div>
  );
}
