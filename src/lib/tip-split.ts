/**
 * Tipping: the settings, the suggested amounts, and the split.
 *
 * Pure — no database, no Stripe. Everything here is arithmetic on cents and
 * therefore testable, which matters more than usual because the failure mode
 * is silent: a split that loses a cent doesn't throw, it just means the sum of
 * what we owe four cleaners is a penny less than what the client paid, and
 * nobody notices until someone reconciles a bank statement.
 */

/** Whole-percent suggestions offered on the public invoice page. */
export type TippingSettings = {
  enabled: boolean;
  presets: number[];
};

/**
 * Off unless an owner says otherwise.
 *
 * Same strictness as automations and for a sharper reason: an unasked-for tip
 * prompt appears on a document the client already received, in the business's
 * name. Defaulting that ON would put words in an owner's mouth in front of
 * their own customer.
 */
export const TIPPING_DEFAULT: TippingSettings = {
  enabled: false,
  presets: [15, 18, 20],
};

/** Guardrails on what an owner can configure. */
const MIN_PRESET = 1;
const MAX_PRESET = 100;
const MAX_PRESETS = 4;

/**
 * A tip has to be bounded somewhere, or a fat-fingered custom amount becomes a
 * card charge nobody can explain. Five figures is far past any real gratuity
 * for a house cleaning and still leaves generous room.
 */
export const MAX_TIP_CENTS = 1_000_000;

/**
 * Read the JSONB column. Survives anything — the column is hand-editable and a
 * malformed row must degrade to "tipping off", never crash a public invoice
 * page that a client is trying to pay through.
 */
export function parseTippingSettings(raw: unknown): TippingSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...TIPPING_DEFAULT };
  }
  const obj = raw as Record<string, unknown>;
  const enabled = obj.enabled === true;

  const presets = Array.isArray(obj.presets)
    ? Array.from(
        new Set(
          obj.presets
            .map((p) => Math.round(Number(p)))
            .filter(
              (p) => Number.isFinite(p) && p >= MIN_PRESET && p <= MAX_PRESET,
            ),
        ),
      )
        .sort((a, b) => a - b)
        .slice(0, MAX_PRESETS)
    : [];

  // Enabled with no usable presets would render a tip row with nothing in it.
  // Fall back to the defaults rather than showing an empty prompt.
  return {
    enabled,
    presets: presets.length > 0 ? presets : [...TIPPING_DEFAULT.presets],
  };
}

/** Normalize an owner's checkbox/number input back into the stored shape. */
export function tippingSettingsFromForm(
  enabled: boolean,
  rawPresets: readonly string[],
): TippingSettings {
  return parseTippingSettings({
    enabled,
    presets: rawPresets.map((p) => Number(p)),
  });
}

export type TipPreset = {
  percent: number;
  cents: number;
};

/**
 * Turn "18%" into an actual amount against the outstanding balance.
 *
 * Rounded to the cent and floored at 1 cent, because a preset that computes to
 * zero (a $0.02 balance at 15%) would render a button that charges nothing and
 * looks broken.
 */
export function tipPresetAmounts(
  balanceCents: number,
  presets: readonly number[],
): TipPreset[] {
  if (!Number.isFinite(balanceCents) || balanceCents <= 0) return [];
  return presets
    .filter((p) => Number.isFinite(p) && p >= MIN_PRESET && p <= MAX_PRESET)
    .map((percent) => ({
      percent,
      cents: Math.max(1, Math.round((balanceCents * percent) / 100)),
    }));
}

/** Clamp a submitted tip to something chargeable, or null for "no tip". */
export function normalizeTipCents(raw: unknown): number | null {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, MAX_TIP_CENTS);
}

export type TipShare = {
  membershipId: string;
  /** Minutes this person is credited with across the invoice's jobs. */
  minutes: number;
};

export type TipAllocation = {
  membershipId: string;
  amountCents: number;
  shareMinutes: number;
};

/**
 * Divide a tip across the people who did the work, weighted by minutes.
 *
 * LARGEST REMAINDER, not naive rounding. Three cleaners splitting $10 each get
 * $3.33 by proportion, and rounding each independently hands out $9.99 — one
 * cent short, every single time, forever. Here the floor is handed out first
 * and the leftover cents go to whoever was cut hardest by the flooring, so the
 * allocations sum to EXACTLY tipCents. That invariant is the whole point of
 * this function and is what the tests pin down.
 *
 * Ties break on the larger share, then on membershipId, so the same input
 * always produces the same output — a split that reshuffles between two runs
 * would make the payout ledger impossible to trust.
 *
 * Everyone with zero minutes is dropped: they'd be allocated nothing anyway,
 * and a $0 row reads as an unpaid debt rather than an absence. If NOBODY has
 * minutes — a job where nothing was ever assigned — this returns empty and the
 * caller records the tip unattributed rather than inventing a recipient.
 */
export function splitTipByMinutes(
  tipCents: number,
  shares: readonly TipShare[],
): TipAllocation[] {
  if (!Number.isFinite(tipCents) || tipCents <= 0) return [];

  const eligible = shares.filter(
    (s) => s.membershipId && Number.isFinite(s.minutes) && s.minutes > 0,
  );
  if (eligible.length === 0) return [];

  // One person takes the whole thing — no arithmetic, no rounding to get wrong.
  if (eligible.length === 1) {
    return [
      {
        membershipId: eligible[0].membershipId,
        amountCents: tipCents,
        shareMinutes: eligible[0].minutes,
      },
    ];
  }

  const totalMinutes = eligible.reduce((sum, s) => sum + s.minutes, 0);

  const provisional = eligible.map((s) => {
    const exact = (tipCents * s.minutes) / totalMinutes;
    const floor = Math.floor(exact);
    return {
      membershipId: s.membershipId,
      shareMinutes: s.minutes,
      amountCents: floor,
      remainder: exact - floor,
    };
  });

  let distributed = provisional.reduce((sum, p) => sum + p.amountCents, 0);
  let leftover = tipCents - distributed;

  const byRemainder = [...provisional].sort(
    (a, b) =>
      b.remainder - a.remainder ||
      b.shareMinutes - a.shareMinutes ||
      a.membershipId.localeCompare(b.membershipId),
  );

  // leftover < eligible.length always, so one pass suffices.
  for (let i = 0; i < byRemainder.length && leftover > 0; i += 1) {
    byRemainder[i].amountCents += 1;
    leftover -= 1;
  }

  // Drop anyone still on zero — possible when the tip is smaller in cents than
  // the number of people sharing it (a $0.02 tip across five cleaners). Two of
  // them get a cent; the other three are not owed anything.
  const allocations = provisional
    .filter((p) => p.amountCents > 0)
    .map(({ membershipId, amountCents, shareMinutes }) => ({
      membershipId,
      amountCents,
      shareMinutes,
    }));

  distributed = allocations.reduce((sum, a) => sum + a.amountCents, 0);
  if (distributed !== tipCents) {
    // Unreachable by construction. Loud rather than silently off-by-a-cent,
    // because this is exactly the bug the function exists to prevent.
    throw new Error(
      `tip split lost money: allocated ${distributed} of ${tipCents}`,
    );
  }

  return allocations;
}
