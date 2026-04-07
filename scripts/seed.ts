/**
 * CleanOps dev seed script.
 *
 * Usage:
 *   pnpm seed               # seeds into the first (oldest) org in the DB
 *   pnpm seed --org <uuid>  # seeds into a specific org
 *   pnpm seed --force       # don't prompt if the org already has data
 *
 * What it does:
 *   1. Finds the target org (first org by created_at, or --org flag value)
 *   2. If the org already has clients/bookings, exits unless --force
 *   3. Creates 4 employee auth users with predictable emails + a password
 *      printed at the end
 *   4. Creates memberships linking those employees to the org
 *   5. Seeds realistic fake data:
 *        - 6 clients
 *        - 3 packages (Basic / Standard / Deep Clean)
 *        - 10 bookings spanning the next 2 weeks, with mixed statuses
 *        - 3 estimates with line items
 *        - 2 contracts
 *        - 5 invoices (mix of paid, sent, overdue, draft)
 *        - 8 reviews with varied ratings
 *        - 2 training modules with 3 steps each, assigned to all employees
 *        - 10 inventory items (some below reorder threshold)
 *
 * Uses the service-role client so RLS doesn't interfere. Reads env vars from
 * `.env.local` which tsx loads automatically via --env-file.
 *
 * Safety:
 *   - Never seeds if NODE_ENV === "production" (unless --allow-prod is set)
 *   - Prints the plan and prompts for confirmation unless --force is set
 */

import { createClient } from "@supabase/supabase-js";
import { faker } from "@faker-js/faker";
import type { Database } from "../src/lib/supabase/types";

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
const FORCE = args.has("--force");
const ALLOW_PROD = args.has("--allow-prod");

const orgFlagIdx = process.argv.indexOf("--org");
const EXPLICIT_ORG_ID =
  orgFlagIdx >= 0 ? process.argv[orgFlagIdx + 1] : undefined;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "❌ Missing env vars. Expected NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

if (process.env.NODE_ENV === "production" && !ALLOW_PROD) {
  console.error(
    "❌ Refusing to run in production. Use --allow-prod if you really mean it.",
  );
  process.exit(1);
}

const EMPLOYEE_PASSWORD = "cleaner-dev-password";
const EMPLOYEE_DOMAIN = "cleanops-seed.local";

const admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function pickN<T>(arr: readonly T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function cents(dollars: number): number {
  return Math.round(dollars * 100);
}

async function die(msg: string, err?: unknown): Promise<never> {
  console.error(`❌ ${msg}`);
  if (err) console.error(err);
  process.exit(1);
}

// -----------------------------------------------------------------------------
// Seed
// -----------------------------------------------------------------------------

async function main() {
  console.log("🌱 CleanOps dev seed");
  console.log("────────────────────");

  // Step 1: find target org
  let orgId: string;
  let orgName: string;

  if (EXPLICIT_ORG_ID) {
    const { data, error } = await admin
      .from("organizations")
      .select("id, name")
      .eq("id", EXPLICIT_ORG_ID)
      .maybeSingle();
    if (error || !data) await die(`Org ${EXPLICIT_ORG_ID} not found`, error);
    orgId = data!.id;
    orgName = data!.name;
  } else {
    const { data, error } = await admin
      .from("organizations")
      .select("id, name")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data) {
      await die(
        "No organizations found. Sign up at /signup first to create one.",
        error,
      );
    }
    orgId = data!.id;
    orgName = data!.name;
  }

  console.log(`Target org: ${orgName} (${orgId})`);

  // Step 2: bail if already populated
  const { count: existingClients } = await admin
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId);

  if ((existingClients ?? 0) > 0 && !FORCE) {
    await die(
      `Org already has ${existingClients} clients. Re-run with --force to wipe and re-seed.`,
    );
  }

  if (FORCE && (existingClients ?? 0) > 0) {
    console.log("⚠️  --force set — wiping existing domain data in this org");
    // Order matters: delete children before parents to avoid FK errors.
    const tables = [
      "audit_log",
      "chat_messages",
      "chat_thread_members",
      "chat_threads",
      "time_entries",
      "bonuses",
      "inventory_log",
      "inventory_items",
      "training_assignments",
      "training_steps",
      "training_modules",
      "reviews",
      "invoice_line_items",
      "invoices",
      "contracts",
      "estimate_line_items",
      "estimates",
      "bookings",
      "packages",
      "clients",
    ] as const;

    for (const t of tables) {
      const { error } = await admin
        .from(t)
        .delete()
        .eq("organization_id", orgId);
      if (error) await die(`Wipe failed on ${t}`, error);
    }

    // Also remove seeded employees (non-owners whose email ends in EMPLOYEE_DOMAIN)
    const { data: seedMembers } = await admin
      .from("memberships")
      .select("id, profile_id, role")
      .eq("organization_id", orgId)
      .neq("role", "owner");

    if (seedMembers) {
      for (const m of seedMembers) {
        // Look up auth.users email to check if it's a seeded user
        const { data: userData } = await admin.auth.admin.getUserById(
          m.profile_id,
        );
        const email = userData?.user?.email ?? "";
        if (email.endsWith(`@${EMPLOYEE_DOMAIN}`)) {
          await admin.from("memberships").delete().eq("id", m.id);
          await admin.auth.admin.deleteUser(m.profile_id);
        }
      }
    }
  }

  // Step 3: employees — create auth users + memberships
  console.log("👷 Creating 4 employee accounts…");
  const employeeNames = [
    "Alex Rivera",
    "Sam Chen",
    "Jordan Patel",
    "Morgan Kowalski",
  ];
  const employeeMemberships: {
    id: string;
    profile_id: string;
    full_name: string;
    email: string;
  }[] = [];

  for (let i = 0; i < employeeNames.length; i++) {
    const fullName = employeeNames[i]!;
    const email = `cleaner${i + 1}@${EMPLOYEE_DOMAIN}`;

    // Create or reuse the auth user
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password: EMPLOYEE_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

    let userId: string;
    if (createErr) {
      if (createErr.message.includes("already") || createErr.code === "email_exists") {
        // Look it up — list users and match by email
        const { data: list } = await admin.auth.admin.listUsers({
          page: 1,
          perPage: 200,
        });
        const existing = list?.users.find((u) => u.email === email);
        if (!existing) await die(`Could not create or find ${email}`, createErr);
        userId = existing!.id;
      } else {
        await die(`Failed to create ${email}`, createErr);
        return;
      }
    } else {
      userId = created.user!.id;
    }

    // Ensure profile has the full name set (trigger created it but may have null)
    await admin
      .from("profiles")
      .update({ full_name: fullName })
      .eq("id", userId);

    // Ensure there's a membership
    const { data: existingMem } = await admin
      .from("memberships")
      .select("id")
      .eq("organization_id", orgId)
      .eq("profile_id", userId)
      .maybeSingle();

    let membershipId: string;
    if (existingMem) {
      membershipId = existingMem.id;
    } else {
      const { data: newMem, error: memErr } = await admin
        .from("memberships")
        .insert({
          organization_id: orgId,
          profile_id: userId,
          role: "employee",
          status: "active",
          pay_rate_cents: cents(22 + i * 2),
        })
        .select("id")
        .single();
      if (memErr || !newMem) await die(`membership insert failed for ${email}`, memErr);
      membershipId = newMem!.id;
    }

    employeeMemberships.push({
      id: membershipId,
      profile_id: userId,
      full_name: fullName,
      email,
    });
  }

  // Step 4: clients
  console.log("🏠 Creating 6 clients…");
  const clientNames = [
    "The Harrington Residence",
    "Bluebird Café",
    "Summit Dental",
    "Cedar Lane Apartments",
    "Ortega Family Home",
    "Nova Coworking",
  ];
  const { data: clients, error: clientsErr } = await admin
    .from("clients")
    .insert(
      clientNames.map((name) => ({
        organization_id: orgId,
        name,
        address: faker.location.streetAddress({ useFullAddress: true }),
        phone: faker.phone.number({ style: "national" }),
        email: faker.internet.email().toLowerCase(),
        preferred_contact: pick(["email", "phone", "sms"] as const),
        notes: Math.random() > 0.5 ? faker.lorem.sentence() : null,
      })),
    )
    .select("id, name");
  if (clientsErr || !clients) await die("clients insert failed", clientsErr);

  // Step 5: packages
  console.log("📦 Creating 3 packages…");
  const { data: packages, error: pkgErr } = await admin
    .from("packages")
    .insert([
      {
        organization_id: orgId,
        name: "Basic Clean",
        description:
          "Standard cleaning for residences up to 1,500 sq ft. Kitchens, bathrooms, living areas.",
        price_cents: cents(129),
        duration_minutes: 120,
        included: [
          "Dusting",
          "Vacuuming",
          "Mopping",
          "Bathrooms",
          "Kitchen surfaces",
        ],
      },
      {
        organization_id: orgId,
        name: "Standard Clean",
        description:
          "Everything in Basic plus baseboards, window sills, and inside the microwave.",
        price_cents: cents(189),
        duration_minutes: 180,
        included: [
          "Everything in Basic",
          "Baseboards",
          "Window sills",
          "Inside microwave",
          "Linens change",
        ],
      },
      {
        organization_id: orgId,
        name: "Deep Clean",
        description:
          "Top-to-bottom deep clean. Recommended quarterly. Includes appliance interiors.",
        price_cents: cents(349),
        duration_minutes: 300,
        included: [
          "Everything in Standard",
          "Inside oven",
          "Inside fridge",
          "Cabinet fronts",
          "Grout scrubbing",
        ],
      },
    ])
    .select("id, name, price_cents, duration_minutes");
  if (pkgErr || !packages) await die("packages insert failed", pkgErr);

  // Step 6: bookings — spread over next 14 days
  console.log("📅 Creating 10 bookings…");
  const bookingStatuses = [
    "completed",
    "completed",
    "completed",
    "confirmed",
    "confirmed",
    "confirmed",
    "in_progress",
    "pending",
    "pending",
    "cancelled",
  ] as const;

  const bookingsToInsert = bookingStatuses.map((status, i) => {
    const client = pick(clients!);
    const pkg = pick(packages!);
    const employee = Math.random() > 0.15 ? pick(employeeMemberships) : null;
    const dayOffset = status === "completed" ? -7 + i : i;
    const scheduled = daysFromNow(dayOffset);
    scheduled.setHours(8 + (i % 8), (i % 4) * 15, 0, 0);

    return {
      organization_id: orgId,
      client_id: client.id,
      address: faker.location.streetAddress({ useFullAddress: true }),
      scheduled_at: scheduled.toISOString(),
      duration_minutes: pkg.duration_minutes,
      service_type: pick(["standard", "deep", "move_out", "recurring"] as const),
      package_id: pkg.id,
      hourly_rate_cents: null,
      assigned_to: employee?.id ?? null,
      status,
      notes: Math.random() > 0.6 ? faker.lorem.sentence() : null,
      total_cents: pkg.price_cents,
    };
  });

  const { data: bookings, error: bookingsErr } = await admin
    .from("bookings")
    .insert(bookingsToInsert)
    .select("id, client_id, assigned_to, status, total_cents, scheduled_at");
  if (bookingsErr || !bookings) await die("bookings insert failed", bookingsErr);

  // Step 7: estimates with line items
  console.log("📄 Creating 3 estimates…");
  const estimatesToInsert = [
    {
      organization_id: orgId,
      client_id: pick(clients!).id,
      service_description: "One-time deep clean before new tenant move-in.",
      status: "sent" as const,
      total_cents: cents(425),
      sent_at: daysFromNow(-2).toISOString(),
    },
    {
      organization_id: orgId,
      client_id: pick(clients!).id,
      service_description: "Weekly recurring service for office.",
      status: "approved" as const,
      total_cents: cents(189),
      sent_at: daysFromNow(-5).toISOString(),
      decided_at: daysFromNow(-3).toISOString(),
    },
    {
      organization_id: orgId,
      client_id: pick(clients!).id,
      service_description: "Post-construction cleaning, 2,400 sq ft.",
      status: "draft" as const,
      total_cents: cents(780),
    },
  ];

  const { data: estimates, error: estErr } = await admin
    .from("estimates")
    .insert(estimatesToInsert)
    .select("id, total_cents");
  if (estErr || !estimates) await die("estimates insert failed", estErr);

  for (const est of estimates!) {
    await admin.from("estimate_line_items").insert([
      {
        organization_id: orgId,
        estimate_id: est.id,
        label: "Labour (4 hours × 2 cleaners)",
        quantity: 8,
        unit_price_cents: cents(35),
        kind: "labour",
        sort_order: 0,
      },
      {
        organization_id: orgId,
        estimate_id: est.id,
        label: "Eco-friendly supplies",
        quantity: 1,
        unit_price_cents: cents(25),
        kind: "supplies",
        sort_order: 1,
      },
    ]);
  }

  // Step 8: contracts
  console.log("📑 Creating 2 contracts…");
  await admin.from("contracts").insert([
    {
      organization_id: orgId,
      client_id: pick(clients!).id,
      estimate_id: estimates![1]!.id,
      service_type: "recurring",
      start_date: daysFromNow(-30).toISOString().slice(0, 10),
      end_date: null,
      agreed_price_cents: cents(189),
      payment_terms: "Net 15, invoiced weekly",
      status: "active",
    },
    {
      organization_id: orgId,
      client_id: pick(clients!).id,
      service_type: "standard",
      start_date: daysFromNow(-60).toISOString().slice(0, 10),
      end_date: daysFromNow(-1).toISOString().slice(0, 10),
      agreed_price_cents: cents(129),
      payment_terms: "Due on completion",
      status: "ended",
    },
  ]);

  // Step 9: invoices
  console.log("💵 Creating 5 invoices…");
  const completedBookings = bookings!.filter((b) => b.status === "completed");
  const invoiceStatuses = ["paid", "paid", "sent", "overdue", "draft"] as const;

  for (let i = 0; i < 5; i++) {
    const booking = completedBookings[i % completedBookings.length]!;
    const status = invoiceStatuses[i]!;
    const dueDate =
      status === "overdue"
        ? daysFromNow(-5).toISOString().slice(0, 10)
        : daysFromNow(7).toISOString().slice(0, 10);

    const { data: invoice } = await admin
      .from("invoices")
      .insert({
        organization_id: orgId,
        client_id: booking.client_id,
        booking_id: booking.id,
        amount_cents: booking.total_cents,
        status,
        due_date: dueDate,
        sent_at: status !== "draft" ? daysFromNow(-3).toISOString() : null,
        paid_at: status === "paid" ? daysFromNow(-1).toISOString() : null,
      })
      .select("id")
      .single();

    if (invoice) {
      await admin.from("invoice_line_items").insert({
        organization_id: orgId,
        invoice_id: invoice.id,
        label: "Cleaning service",
        quantity: 1,
        unit_price_cents: booking.total_cents,
        sort_order: 0,
      });
    }
  }

  // Step 10: reviews
  console.log("⭐ Creating 8 reviews…");
  const reviewRatings = [5, 5, 5, 5, 4, 4, 3, 5];
  const reviewComments = [
    "Alex did an amazing job — everything spotless.",
    "Best cleaning service we've used. Will book again.",
    "Sam was friendly and thorough. Highly recommend.",
    "Kitchen looks brand new, thanks!",
    "Good work overall, a few spots missed on the baseboards.",
    "On time and professional.",
    "Fine, but took longer than expected.",
    "Fantastic attention to detail.",
  ];

  const bookingsWithEmployees = bookings!.filter((b) => b.assigned_to);

  for (let i = 0; i < reviewRatings.length; i++) {
    const booking =
      bookingsWithEmployees[i % bookingsWithEmployees.length] ?? bookings![0]!;
    await admin.from("reviews").insert({
      organization_id: orgId,
      booking_id: booking.id,
      client_id: booking.client_id,
      employee_id: booking.assigned_to,
      rating: reviewRatings[i]!,
      comment: reviewComments[i]!,
      submitted_at: daysFromNow(-i - 1).toISOString(),
    });
  }

  // Step 11: training modules + steps + assignments
  console.log("🎓 Creating 2 training modules…");
  const { data: mod1 } = await admin
    .from("training_modules")
    .insert({
      organization_id: orgId,
      title: "Safe use of cleaning chemicals",
      description:
        "Handling bleach, ammonia, and acid-based cleaners safely. Never mix.",
    })
    .select("id")
    .single();

  const { data: mod2 } = await admin
    .from("training_modules")
    .insert({
      organization_id: orgId,
      title: "Professional client interaction",
      description:
        "How to greet clients, handle requests, and leave a great impression.",
    })
    .select("id")
    .single();

  if (mod1) {
    await admin.from("training_steps").insert([
      {
        organization_id: orgId,
        module_id: mod1.id,
        ord: 0,
        body: "Always read the product label before use. Never mix chemicals.",
      },
      {
        organization_id: orgId,
        module_id: mod1.id,
        ord: 1,
        body: "Wear gloves and eye protection when handling bleach or acid cleaners.",
      },
      {
        organization_id: orgId,
        module_id: mod1.id,
        ord: 2,
        body: "Ventilate the room. Open a window or turn on the exhaust fan.",
      },
    ]);
  }

  if (mod2) {
    await admin.from("training_steps").insert([
      {
        organization_id: orgId,
        module_id: mod2.id,
        ord: 0,
        body: "Greet the client with eye contact and a smile. Introduce yourself by name.",
      },
      {
        organization_id: orgId,
        module_id: mod2.id,
        ord: 1,
        body: "Confirm the scope of the job before starting. Ask about priorities.",
      },
      {
        organization_id: orgId,
        module_id: mod2.id,
        ord: 2,
        body: "Leave a brief note or text thanking the client when the job is complete.",
      },
    ]);
  }

  // Assign both modules to all employees
  for (const emp of employeeMemberships) {
    for (const mod of [mod1, mod2].filter(Boolean)) {
      await admin.from("training_assignments").insert({
        organization_id: orgId,
        module_id: mod!.id,
        employee_id: emp.id,
        completed_step_ids: [],
      });
    }
  }

  // Step 12: inventory items
  console.log("🧴 Creating 10 inventory items…");
  await admin.from("inventory_items").insert([
    {
      organization_id: orgId,
      name: "All-purpose cleaner (1 gal)",
      category: "chemical",
      quantity: 12,
      reorder_threshold: 4,
    },
    {
      organization_id: orgId,
      name: "Glass cleaner (32 oz)",
      category: "chemical",
      quantity: 3, // below threshold
      reorder_threshold: 6,
    },
    {
      organization_id: orgId,
      name: "Bleach (1 gal)",
      category: "chemical",
      quantity: 8,
      reorder_threshold: 3,
    },
    {
      organization_id: orgId,
      name: "Microfiber cloths (pack of 24)",
      category: "consumable",
      quantity: 5,
      reorder_threshold: 2,
    },
    {
      organization_id: orgId,
      name: "Mop heads",
      category: "consumable",
      quantity: 1, // below threshold
      reorder_threshold: 4,
    },
    {
      organization_id: orgId,
      name: "Nitrile gloves (box of 100)",
      category: "consumable",
      quantity: 14,
      reorder_threshold: 5,
    },
    {
      organization_id: orgId,
      name: "Commercial vacuum",
      category: "equipment",
      quantity: 4,
      reorder_threshold: 2,
      assigned_to: employeeMemberships[0]!.id,
    },
    {
      organization_id: orgId,
      name: "Floor buffer",
      category: "equipment",
      quantity: 1,
      reorder_threshold: 1,
      assigned_to: employeeMemberships[1]!.id,
    },
    {
      organization_id: orgId,
      name: "Extension poles",
      category: "equipment",
      quantity: 6,
      reorder_threshold: 3,
    },
    {
      organization_id: orgId,
      name: "Trash bags (contractor, 50 ct)",
      category: "consumable",
      quantity: 2, // below threshold
      reorder_threshold: 4,
    },
  ]);

  // ----- Done -----
  console.log("");
  console.log("✅ Seed complete!");
  console.log("");
  console.log("Employees (password: " + EMPLOYEE_PASSWORD + "):");
  for (const e of employeeMemberships) {
    console.log(`  - ${e.full_name} <${e.email}>`);
  }
  console.log("");
  console.log(`Org: ${orgName} (${orgId})`);
}

main().catch((err) => {
  console.error("❌ Seed failed");
  console.error(err);
  process.exit(1);
});
