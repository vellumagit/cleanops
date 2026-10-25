/**
 * Turn a pasted list into checklist rows: sections, sub-sections and items.
 *
 * Svitlana writes her checklists in an email, like this:
 *
 *   KITCHEN                      ← section   (ALL CAPS)
 *   Appliances                   ← subsection (a short label, not a task)
 *   Clean inside and outside of microwave   ← item
 *
 * A task starts with a verb ("Clean…", "Wipe…", "Dust…"); a sub-section is a
 * short label that doesn't ("Appliances", "Sink & Fixtures", "Toilet"). A
 * line ending in ":" is always a sub-section. This only guesses — the editor
 * shows every row's type after pasting, so a wrong guess is one click to fix.
 */

export type ChecklistKind = "item" | "section" | "subsection";
export type PastedRow = { title: string; kind: ChecklistKind };

// First words that mark a line as a task, not a heading. Lowercase.
const TASK_VERBS = new Set([
  "add", "apply", "arrange", "brush", "change", "check", "clean", "clear",
  "collect", "degrease", "deep", "descale", "detail", "disinfect", "do",
  "dry", "dust", "empty", "fold", "hang", "launder", "load", "make", "mop",
  "move", "organize", "organise", "pick", "polish", "put", "refill",
  "refresh", "remove", "replace", "restock", "rinse", "sanitize",
  "sanitise", "scrape", "scrub", "shampoo", "sort", "spot", "spray",
  "straighten", "sweep", "take", "tidy", "unload", "unscrew", "vacuum",
  "wash", "wipe",
]);

function isAllCaps(s: string): boolean {
  return /[A-Z]/.test(s) && !/[a-z]/.test(s);
}

/** Bullets, numbers and checkbox marks people paste along with a list. */
function stripMarker(line: string): string {
  return line
    .replace(/^\s*(?:[-*•·–—]|\[\s?[xX]?\s?\]|☐|☑|✓|✔|\d+[.)])\s+/, "")
    .trim();
}

export function parseChecklistPaste(text: string): PastedRow[] {
  const rows: PastedRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = stripMarker(raw);
    if (!line) continue;

    if (isAllCaps(line) && line.split(/\s+/).length <= 6) {
      rows.push({ title: line, kind: "section" });
      continue;
    }
    if (/:\s*$/.test(line)) {
      rows.push({ title: line.replace(/:\s*$/, "").trim(), kind: "subsection" });
      continue;
    }
    const words = line.split(/\s+/);
    // "Vacuum/sweep…" → "vacuum": the word before any slash or punctuation.
    const first = words[0].toLowerCase().split(/[^a-z]/)[0];
    const looksLikeLabel =
      words.length <= 4 && !TASK_VERBS.has(first) && !/[.!?]$/.test(line);
    rows.push({ title: line, kind: looksLikeLabel ? "subsection" : "item" });
  }
  return rows;
}
