import type { FormEvent } from "react";

/**
 * `onReset` for a form that edits saved settings in place: after Save, the
 * screen must keep showing what was just saved.
 *
 * WHY THIS EXISTS. React 19 resets a `<form action={fn}>` the moment its
 * action succeeds (a convenience for "add another" forms). A browser form
 * reset puts every checkbox back to `defaultChecked` and every select back
 * to its `defaultSelected` option: the values the page was FIRST drawn
 * with. React never updates those for a CONTROLLED input. Its state still
 * holds what you ticked, so it sees nothing to redraw, and the boxes sit
 * there showing the old values until a reload.
 *
 * The 2026-08-28 cure (864065ee: controlled boxes re-seeded from fresh
 * props) could not reach this: the state was never wrong, only the screen,
 * and re-seeding the state with the same values draws nothing. Measured on
 * the test stack, 2026-11-24: "What alerts you" with every box ticked and
 * saved showed every box unticked, toast and all; bonus rules did the same.
 *
 * Cancelling the reset event stops the reset; the action itself, its
 * state, toasts and revalidation are untouched. Don't put this on a form
 * that is meant to clear itself after submitting (quick-add, announce).
 */
export function keepFormOnSave(event: FormEvent<HTMLFormElement>): void {
  event.preventDefault();
}
