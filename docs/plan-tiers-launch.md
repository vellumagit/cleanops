# New plan tiers: what's built and how to switch them on

Decided 2026-11-14:

| Plan       | Price   | Cleaners | Texts / month |
| ---------- | ------- | -------- | ------------- |
| Starter    | $59/mo  | up to 3  | 300           |
| Team (new) | $119/mo | up to 10 | 750           |
| Growth     | $189/mo | up to 25 | 1,500         |
| Enterprise | custom  | 25+      | 5,000         |

## What the code does now

- **Team is a real plan.** It's in `PlanTier`, checkout accepts it, and the
  webhook maps its price to `plan_tier = 'team'` (`src/lib/stripe.ts`).
  It reads `STRIPE_PRICE_TEAM`. If that isn't set, nobody can buy Team.
- **Included texts per plan** are set in `SMS_INCLUDED_BY_PLAN` (`src/lib/sms.ts`).
  A company with no plan (trial, legacy) gets Starter's 300. Comped
  companies keep the 5,000 safety ceiling and are never billed overage.
- **Cleaner limits** are in `src/lib/plan-limits.ts`.
  - **Who counts:** a cleaner is an *active* member with the employee role,
    whether they're an employee or a subcontractor. Owners, admins and
    managers don't count.
  - **Where it's checked:** adding someone by hand, sending an invite (open
    invites count too), reactivating someone, moving an office member onto
    the crew, and accepting an invite.
  - **Who is exempt:**
    - comped companies (`billing_override`, which a redeemed discount code sets)
    - legacy companies with no trial clock
    - Enterprise
    - everyone, while `STRIPE_ENABLED` is not `true`
  - **Trials** get Growth's limit of 25.
  - **A price this build doesn't recognise** means no limit (fails open).
  - **Nobody is ever deactivated.** A company over its limit keeps everyone.
    It can still edit or deactivate people, but it can't add more.
- **Tests:** `test/db/plan-tiers.api.test.ts`.

## Switching on: do these in order

The limits only turn on with billing (`STRIPE_ENABLED=true`). Until then
nothing changes for anyone. Starter's limit is 3 but the site still says
"up to 5", so **ship the copy change in the same push that turns billing on**.

### 1. Run the migration (before any push)

Supabase SQL editor → paste and run
`supabase/migrations/20261116010000_plan_tier_team.sql`.
It allows `team` in `subscriptions.plan_tier`. Without it, the webhook
can't save a Team subscription. It only adds a value, so it's safe to run any time.

### 2. Create the new prices in Stripe

Stripe can't change what an existing price charges. You make new prices
and point the app at them. Do this in **live mode**, and in test mode too
if you test checkout there.

1. Stripe Dashboard → **Product catalog**.
2. **Starter:** open the product that has the $49 price → **Add another price**
   → Recurring, Monthly, **$59.00 USD** → Save. Copy its ID (`price_…`).
3. **Growth:** same, on the product that has the $99 price, **$189.00 USD**.
   Copy the ID.
4. **Team:** **+ Add product** → name it "Sollos Team" → Recurring, Monthly,
   **$119.00 USD** → Save. Copy the price ID.
5. Optional: archive the old $49 and $99 prices so nobody gets sent to them.
   Archiving never touches existing subscriptions, and there are no paying ones.
6. If customers can switch plans in the Customer Portal
   (Settings → Billing → Customer portal → Subscriptions), add the three new
   prices there, and remove the old ones.

### 3. Set the Vercel environment variables

Vercel → project **cleanops** → Settings → Environment Variables. Use
Production, plus Preview if you test there:

| Variable               | Value               |
| ---------------------- | ------------------- |
| `STRIPE_PRICE_STARTER` | the new $59 price   |
| `STRIPE_PRICE_TEAM`    | the $119 price (new variable) |
| `STRIPE_PRICE_GROWTH`  | the new $189 price  |

Changes to these variables only take effect on the next deploy, which is
the next push to `main`. Don't redeploy with the CLI.

### 4. Ship the copy and turn billing on

Merge the copy branch (`claude/plan-tiers-copy`), set `STRIPE_ENABLED=true`
in Vercel, and push.

## Check that Velluma and Svit are comped

Comped companies are exempt from every limit. To confirm both are, run this
in the Supabase SQL editor:

```sql
select name, billing_override, billing_override_at
from public.organizations
where billing_override is not null
order by name;
```

Both should be listed with `comp` or `free_forever`. If one isn't, redeem a
discount code from that company's Settings → Billing, or set it directly:

```sql
update public.organizations
set billing_override = 'comp', billing_override_at = now(),
    billing_override_note = 'Comped by Brian'
where name = '…';
```
