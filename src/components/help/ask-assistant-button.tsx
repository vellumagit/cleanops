"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/** Opens the assistant panel with a question already typed in. The panel
 *  lives in the app layout; this only asks it to open (see ai-widget). */
export const ASK_ASSISTANT_EVENT = "sollos:assistant-ask";

export function askAssistant(question: string) {
  window.dispatchEvent(new CustomEvent(ASK_ASSISTANT_EVENT, { detail: { question } }));
}

export function AskAssistantButton({
  question,
  label = "Ask the assistant",
  className,
}: {
  question: string;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => askAssistant(question)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted",
        className,
      )}
    >
      <Sparkles className="h-3.5 w-3.5 text-primary" />
      {label}
    </button>
  );
}
