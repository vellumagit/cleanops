/**
 * "This and all future" after the edited visit moved to another day.
 *
 * The series' weekday comes from where it starts, and the form pre-fills the
 * start with the visit's OLD date. So a visit moved from Thursday to
 * Wednesday, with nothing else touched, still described a Thursday series and
 * the save treated it as no schedule change at all.
 */
export function resolveSeriesMove({
  oldDate,
  newDate,
  postedStartsAt,
}: {
  /** The edited visit's org-local date before this save (YYYY-MM-DD). */
  oldDate: string;
  /** Its org-local date after this save. */
  newDate: string;
  /** The form's series "starts" field as posted. */
  postedStartsAt: string;
}): { visitDayMoved: boolean; startsAt: string } {
  const visitDayMoved = oldDate !== "" && newDate !== oldDate;
  // Untouched (still the old date) or blank: start where the visit is now.
  // A start someone typed on purpose wins.
  const startsAt =
    visitDayMoved && (postedStartsAt === "" || postedStartsAt === oldDate)
      ? newDate
      : postedStartsAt;
  return { visitDayMoved, startsAt };
}
