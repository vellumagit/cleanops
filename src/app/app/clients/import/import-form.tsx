"use client";

import { useState, useTransition, useRef } from "react";
import Link from "next/link";
import { Upload, CheckCircle2, AlertCircle, Loader2, FileText } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { importClientsAction, type ImportResult } from "./actions";

export function ImportForm() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function onSubmit(formData: FormData) {
    setResult(null);
    startTransition(async () => {
      const r = await importClientsAction(formData);
      setResult(r);
    });
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFileName(e.target.files?.[0]?.name ?? null);
    setResult(null);
  }

  return (
    <form action={onSubmit} className="space-y-5">
      <label
        htmlFor="file"
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/20 px-6 py-10 text-center hover:bg-muted/30 transition-colors"
      >
        {fileName ? (
          <>
            <FileText className="h-8 w-8 text-muted-foreground" />
            <div className="text-sm font-medium">{fileName}</div>
            <div className="text-xs text-muted-foreground">
              Click to choose a different file
            </div>
          </>
        ) : (
          <>
            <Upload className="h-8 w-8 text-muted-foreground" />
            <div className="text-sm font-medium">Click to upload a CSV</div>
            <div className="text-xs text-muted-foreground">Max 5 MB</div>
          </>
        )}
        <input
          id="file"
          ref={fileRef}
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          onChange={onFileChange}
          className="sr-only"
          disabled={isPending}
        />
      </label>

      <div className="flex items-center justify-between gap-2">
        <Link
          href="/app/clients"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Cancel
        </Link>
        <Button type="submit" disabled={isPending || !fileName}>
          {isPending ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              Importing…
            </>
          ) : (
            <>
              <Upload className="mr-1.5 h-4 w-4" />
              Import clients
            </>
          )}
        </Button>
      </div>

      {result && result.ok && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-200">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Import complete</p>
              <p className="mt-1 text-xs">
                {result.created} new client{result.created !== 1 ? "s" : ""} added
                {result.skipped > 0 &&
                  `, ${result.skipped} duplicate${result.skipped !== 1 ? "s" : ""} skipped`}
                .
              </p>
              {result.errors.length > 0 && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer">
                    {result.errors.length} row
                    {result.errors.length !== 1 ? "s" : ""} had warnings
                  </summary>
                  <ul className="mt-1 ml-4 list-disc space-y-0.5">
                    {result.errors.slice(0, 20).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                    {result.errors.length > 20 && (
                      <li>…and {result.errors.length - 20} more</li>
                    )}
                  </ul>
                </details>
              )}
              <Link
                href="/app/clients"
                className="mt-2 inline-block font-medium underline-offset-4 hover:underline"
              >
                View clients →
              </Link>
            </div>
          </div>
        </div>
      )}

      {result && !result.ok && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-200">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Import failed</p>
              <p className="mt-1 text-xs">{result.error}</p>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
