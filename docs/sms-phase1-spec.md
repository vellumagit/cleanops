# SMS Phase 1 — Self-serve per-org texting (outbound + metered billing)

Status: BUILT (pieces 1–7, 2026-07-07) — typecheck + lint clean. Pending to go
live: (a) run migration 20260707010000_sms_phase1.sql; (b) a Twilio account +
TWILIO_* env vars; (c) STRIPE_PRICE_SMS_OVERAGE (metered price); (d) each org
flips SMS on in Settings → SMS. Owner: Brian. Last updated: 2026-07-07.

Phase 1 = each org can turn on SMS **themselves** in Settings, get **their own
number**, and send automated texts (confirmations/reminders) from it, billed as
an add-on on their existing Sollos subscription. Phase 2 (two-way inbox) is
separate and depends on this.

## Decisions locked

- **Per-org number**, self-serve provisioning (no manual setup per customer).
- **Packaging = bundled into existing plans** (model B), NOT a separate add-on.
  SMS comes *with* the Sollos plan up to an included allotment; only overage is
  charged. Removes adoption friction; goal is stickiness (value-add, modest
  margin).
- **Overage = auto-metered + hard cap** (past the included allotment, each text
  is billed; SMS pauses at a cap the org sets — never a surprise bill).
- **Comped orgs (`billing_override`) get SMS free** — full allotment, overage
  metering SKIPPED (see Comp handling below).
- **Single main Twilio account** holding all org numbers (recommended over
  subaccounts — we bill through Stripe, so we don't need Twilio-level billing
  isolation until real scale).

## Packaging & pricing (model B — your numbers to set)

SMS is **included in the plan**, not sold separately:

| Plan | Included texts/mo | Overage |
|---|---|---|
| Starter ($49) | TBD — 0 (upsell) or a small allotment | $0.03/text, metered |
| Growth ($99) | e.g. **500–1,000** | $0.03/text, metered |
| Comped (`free_forever`/`comp`) | full allotment, **overage waived** | — |

Open packaging decision: **SMS on all paid plans**, or **Growth+ only** as an
upsell lever. Recommendation: an allotment on every paid plan (adoption), larger
on Growth. Overage cap org-set, **default $50/mo**; SMS pauses at cap.

Cost reality: ~$1.15/mo number + ~1–2¢/text. The plan already covers it; overage
at 3¢ on ~1–2¢ cost keeps margin on heavy users.

## Comp handling (Svit's gift + any future comp)

`organizations.billing_override IN ('free_forever','comp')` → gate `overridden`
(see `src/lib/subscription.ts`). SMS entitlement must treat this as **top-tier
access**, because a comped org has no plan tier to read:
- Grant the **full included allotment** (do not fall through plan-tier gating).
- **Skip Stripe overage metering entirely** — no subscription to bill; the org
  is never charged for texts.
- Keep an **internal safety cap** (high default, org-invisible) so a runaway
  can't silently cost the platform owner real Twilio money. Configurable to
  unlimited.

## Architecture (rides on existing Stripe subscription infra)

### 1. DB migration

`organizations` — add:
- `sms_enabled boolean not null default false`
- `sms_from_number text` — provisioned Twilio number, E.164
- `sms_number_sid text` — Twilio IncomingPhoneNumber SID (for release)
- `sms_overage_cap_cents integer not null default 5000`
- `sms_addon_item_id text` / `sms_overage_item_id text` — Stripe subscription
  item IDs (for reporting usage + removal on disable)

New table `sms_messages` (doubles as the usage ledger **and** the Phase-2 inbox
foundation):
- `id`, `organization_id`, `direction` ('outbound'|'inbound'), `to_number`,
  `from_number`, `body`, `segments int`, `status`, `twilio_sid`, `client_id
  null`, `created_at`
- Index on `(organization_id, created_at)` — period counts read from here.

### 2. Twilio provisioning module (`src/lib/twilio-provision.ts`, new)

- `provisionOrgNumber(orgId)` — pick area code from the org's phone/address,
  search `AvailablePhoneNumbers` (Local, CA), buy via `IncomingPhoneNumbers`,
  store `sms_from_number` + `sms_number_sid`, set the number's inbound webhook
  URL now (harmless in Phase 1, ready for Phase 2).
- `releaseOrgNumber(orgId)` — release on disable (optional; or keep + stop
  billing the add-on).

### 3. `sendSms` rewrite (`src/lib/twilio.ts`)

- New signature `sendSms(orgId, to, body)`.
- Resolve the **org's** `sms_from_number`; if `!sms_enabled` or no number → skip.
- Gate before send: count this period's outbound rows in `sms_messages`.
  - `< 1,000` → send (included).
  - `>= 1,000` → allowed only if `overage_spent_cents + 3 <= cap`; else skip +
    fire cap alert (once).
- After send: insert `sms_messages` row with `segments`. If in overage, report 1
  usage unit to the Stripe metered item (`sms_overage_item_id`).

### 4. Stripe wiring (`src/lib/stripe.ts`)

Model B — the included allotment is part of the plan they already pay, so there
is **no separate add-on price**. Only overage is metered:

- One new price (env): `STRIPE_PRICE_SMS_OVERAGE` (metered, $0.03/unit).
- On enable (paid orgs): add the metered overage item to the org's existing
  subscription; store `sms_overage_item_id`.
- Report only the units **past the plan's included allotment**, so the invoice
  reads "[plan] $99 + SMS overage $X".
- **Comped orgs**: never add the item, never report usage (overage waived).
- On disable: remove/park the item.

### 5. Settings → SMS UI (`src/app/app/settings/…`)

- Enable toggle, gated behind an active subscription / payment method on file.
- On enable → provision number → show "Your texting number: +1 …".
- Usage meter: "740 / 1,000 texts this month" + "$X overage" + cap field.
- Consent + footer copy shown to the owner.

### 6. Route existing outbound triggers through per-org `sendSms`

Confirmations / reminders that already call `sendSms` → pass `orgId`.

### 7. Compliance (CASL)

- Capture client consent (flag + timestamp/source) before texting them.
- STOP/HELP auto-handled by Twilio Advanced Opt-Out on the number (Phase 1 relies
  on Twilio's automatic opt-out; Phase 2 reflects it on the client via webhook).
- Every message footer: business name + "Reply STOP to opt out".

### 8. Cap alerts

Near-cap / cap-reached → `notify({ audience: 'org-admins', … })` (the primitive
we already built routes this correctly — never to cleaners).

## Prerequisite (blocks provisioning)

A **Twilio account with a payment method** and programmatic number purchasing
enabled. Canadian **local** numbers are available without US A2P 10DLC; a
regulatory address/bundle may be required for some CA number types.

## Out of scope — Phase 2 (two-way inbox)

Inbound webhook route, conversation threading UI, reply→org/client routing, and
reflecting STOP opt-outs on the client record. `sms_messages` + the per-org
number + the pre-set inbound webhook are laid down here so Phase 2 is additive.
