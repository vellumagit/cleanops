"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageSquareText, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  startInterviewAction,
  saveInterviewAction,
  deleteInterviewAction,
} from "./interview-actions";

export type InterviewRow = {
  id: string;
  title: string;
  questions: string[];
  answers: string[];
  notes: string | null;
  conducted_by_name: string | null;
  created_at: string;
};

export type QuestionnaireOption = { id: string; title: string };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * One recorded interview: the questions as they were asked (snapshot),
 * an answer box per question, one save. Uncontrolled inputs + FormData
 * keep typing cheap; the snapshot's length is the authority server-side.
 */
function InterviewCard({ interview }: { interview: InterviewRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);

  const answered = interview.answers.filter((a) => a.trim().length > 0).length;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveInterviewAction(interview.id, fd);
      if (res.ok) {
        toast.success("Interview saved");
        setDirty(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function remove() {
    if (!confirm(`Delete the "${interview.title}" interview? Answers are gone for good.`)) {
      return;
    }
    startTransition(async () => {
      const res = await deleteInterviewAction(interview.id);
      if (res.ok) {
        toast.success("Interview deleted");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <details className="rounded-xl border border-border bg-card" open={answered < interview.questions.length}>
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3.5">
        <span className="flex min-w-0 items-center gap-2">
          <MessageSquareText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-semibold">
            {interview.title}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {answered}/{interview.questions.length} answered ·{" "}
          {formatDate(interview.created_at)}
          {interview.conducted_by_name
            ? ` · ${interview.conducted_by_name}`
            : ""}
        </span>
      </summary>
      <form onSubmit={onSubmit} className="space-y-4 border-t border-border px-5 py-4">
        {interview.questions.map((q, i) => (
          <div key={i}>
            <label
              htmlFor={`${interview.id}-answer-${i}`}
              className="text-sm font-medium"
            >
              {i + 1}. {q}
            </label>
            <textarea
              id={`${interview.id}-answer-${i}`}
              name={`answer_${i}`}
              defaultValue={interview.answers[i] ?? ""}
              onChange={() => setDirty(true)}
              rows={2}
              placeholder="Their answer…"
              className="mt-1 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </div>
        ))}
        <div>
          <label
            htmlFor={`${interview.id}-notes`}
            className="text-sm font-medium"
          >
            Interview notes
          </label>
          <textarea
            id={`${interview.id}-notes`}
            name="notes"
            defaultValue={interview.notes ?? ""}
            onChange={() => setDirty(true)}
            rows={3}
            placeholder="Overall impression, follow-ups, anything off-script…"
            className="mt-1 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </div>
        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={pending}
            onClick={remove}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-destructive disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete interview
          </button>
          <Button type="submit" size="sm" disabled={pending || !dirty}>
            {pending ? "Saving…" : "Save answers"}
          </Button>
        </div>
      </form>
    </details>
  );
}

export function InterviewPanel({
  applicantId,
  interviews,
  questionnaires,
}: {
  applicantId: string;
  interviews: InterviewRow[];
  questionnaires: QuestionnaireOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [docId, setDocId] = useState(questionnaires[0]?.id ?? "");

  function start() {
    if (!docId) return;
    startTransition(async () => {
      const res = await startInterviewAction(applicantId, docId);
      if (res.ok) {
        toast.success("Interview started");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      {interviews.map((iv) => (
        <InterviewCard key={iv.id} interview={iv} />
      ))}

      <div className="rounded-xl border border-dashed border-border bg-card/50 px-5 py-4">
        {questionnaires.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No interview questionnaires yet — write one in{" "}
            <a href="/app/hiring" className="underline underline-offset-2">
              Hiring
            </a>{" "}
            and it becomes startable here.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {interviews.length === 0 ? "Run an interview:" : "Another round:"}
            </span>
            <select
              value={docId}
              onChange={(e) => setDocId(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring"
            >
              {questionnaires.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.title}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              onClick={start}
              disabled={pending || !docId}
            >
              <Play className="h-3.5 w-3.5" />
              {pending ? "Starting…" : "Start"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Questions are copied in — editing the library later never
              rewrites a recorded interview.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
