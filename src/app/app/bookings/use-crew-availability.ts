"use client";

import { useEffect, useState } from "react";
import type { Unavailable } from "@/lib/crew-availability";
import { getCrewAvailabilityAction } from "./crew-availability";

/**
 * Who isn't free for the visit being filled in, kept in step with the
 * form's date, time and length.
 *
 * - "none": nothing to check against (no date yet, or a recurring series,
 *   where one answer can't speak for every visit). The picker shows everyone.
 * - "loading": asked, not answered. The picker shows everyone meanwhile.
 * - "failed": the check didn't work. Everyone is shown and the picker says
 *   so; a failed check must never read as "everyone is free".
 *
 * The answer is kept with the question it answers, so the last time's
 * answer never stands in for this one while it loads.
 */
export type CrewAvailability =
  | { status: "none" | "loading" | "failed" }
  | { status: "ready"; unavailable: Record<string, Unavailable> };

export function useCrewAvailability(input: {
  enabled: boolean;
  scheduledAtLocal: string;
  durationMinutes: number;
  excludeBookingId?: string;
  /** Who is picked so far, and whether this visit's hours are shared: a
   *  shared visit is shorter for each person the more people are on it. */
  crewIds: string[];
  dividesHours: boolean;
}): CrewAvailability {
  const { enabled, scheduledAtLocal, durationMinutes, excludeBookingId, dividesHours } = input;
  const crewKey = [...input.crewIds].sort().join(",");
  const valid = enabled && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(scheduledAtLocal);
  const question = valid
    ? `${scheduledAtLocal}|${durationMinutes}|${excludeBookingId ?? ""}|${dividesHours ? 1 : 0}|${crewKey}`
    : null;
  const [answer, setAnswer] = useState<{
    question: string;
    unavailable: Record<string, Unavailable> | null;
  } | null>(null);

  useEffect(() => {
    if (!question) return;
    let cancelled = false;
    // A datetime-local fires per keystroke, and so does the length.
    const t = setTimeout(async () => {
      let res: Awaited<ReturnType<typeof getCrewAvailabilityAction>>;
      try {
        res = await getCrewAvailabilityAction({
          scheduledAtLocal,
          durationMinutes,
          excludeBookingId: excludeBookingId ?? null,
          crewIds: crewKey ? crewKey.split(",") : [],
          dividesHours,
        });
      } catch {
        res = { ok: false };
      }
      if (cancelled) return;
      setAnswer({ question, unavailable: res.ok ? res.unavailable : null });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [question, scheduledAtLocal, durationMinutes, excludeBookingId, crewKey, dividesHours]);

  if (!question) return { status: "none" };
  // While a new answer loads after a change of crew, the last one for the
  // same time stays up: blanking the list on every tap would make the
  // buttons jump under the finger.
  const sameVisit = (q: string) => q.split("|").slice(0, 3).join("|");
  if (answer && answer.question !== question && answer.unavailable && sameVisit(answer.question) === sameVisit(question)) {
    return { status: "ready", unavailable: answer.unavailable };
  }
  if (!answer || answer.question !== question) return { status: "loading" };
  if (!answer.unavailable) return { status: "failed" };
  return { status: "ready", unavailable: answer.unavailable };
}
