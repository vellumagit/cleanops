/**
 * Read-only diagnostic: why can't an owner start a chat / message employees?
 *
 * Prints, per org: every membership (role, status, whether it has a login
 * account via profile_id) and every pending invitation. The "New DM" picker
 * only lists memberships with status='active'; pending email invites have NO
 * membership until accepted, and manually-added employees are active but have
 * profile_id=null (no login → can't open the field app).
 *
 * Usage: npx tsx --env-file=.env.local scripts/verify-chat-readiness.ts
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE env vars. Run with --env-file=.env.local");
  process.exit(1);
}

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
};

async function rest<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers });
  if (!res.ok) {
    throw new Error(`${pathAndQuery} → ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

type Org = { id: string; name: string | null };
type Member = {
  id: string;
  organization_id: string;
  role: string;
  status: string;
  profile_id: string | null;
  display_name: string | null;
  contact_email: string | null;
};
type Invite = {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  accepted_at: string | null;
  created_at: string;
};

async function main() {
  const [orgs, members, invites] = await Promise.all([
    rest<Org[]>("organizations?select=id,name&order=name"),
    rest<Member[]>(
      "memberships?select=id,organization_id,role,status,profile_id,display_name,contact_email",
    ),
    rest<Invite[]>(
      "invitations?select=id,organization_id,email,role,accepted_at,created_at&accepted_at=is.null",
    ),
  ]);

  for (const org of orgs) {
    const orgMembers = members.filter((m) => m.organization_id === org.id);
    const orgInvites = invites.filter((i) => i.organization_id === org.id);

    console.log("\n" + "=".repeat(64));
    console.log(`ORG: ${org.name ?? "(unnamed)"}  [${org.id}]`);
    console.log("=".repeat(64));

    // The picker lists everyone EXCEPT the current user. So for any given
    // owner, "messageable" = active members other than themselves.
    const active = orgMembers.filter((m) => m.status === "active");
    const activeWithLogin = active.filter((m) => m.profile_id);
    const activeShadow = active.filter((m) => !m.profile_id);

    console.log(
      `Memberships: ${orgMembers.length} total · ${active.length} active ` +
        `(${activeWithLogin.length} with login, ${activeShadow.length} shadow/no-login)`,
    );
    for (const m of orgMembers) {
      const login = m.profile_id ? "has-login" : "NO-LOGIN(shadow)";
      const tag = m.status !== "active" ? `  <-- status=${m.status}` : "";
      console.log(
        `  · ${(m.display_name ?? m.contact_email ?? m.id).padEnd(28)} ` +
          `${m.role.padEnd(8)} ${m.status.padEnd(9)} ${login}${tag}`,
      );
    }

    console.log(`Pending invitations (no membership yet): ${orgInvites.length}`);
    for (const i of orgInvites) {
      console.log(
        `  · ${i.email.padEnd(34)} ${i.role.padEnd(8)} invited ${i.created_at.slice(0, 10)}`,
      );
    }

    // Diagnosis for an owner trying to DM:
    const messageableForOwner = active.length - 1; // minus themselves
    if (messageableForOwner <= 0) {
      console.log(
        "DIAGNOSIS: picker is EMPTY for the owner — nobody active to DM. " +
          (orgInvites.length > 0
            ? "Invites are pending; those people have no membership until they accept."
            : "No other members exist yet."),
      );
    } else if (activeShadow.length > 0) {
      console.log(
        `DIAGNOSIS: owner CAN start ${messageableForOwner} DM(s), but ` +
          `${activeShadow.length} active member(s) have no login and cannot open ` +
          "the field app to read messages.",
      );
    } else {
      console.log(
        `DIAGNOSIS: owner can DM ${messageableForOwner} member(s), all with logins. ` +
          "Chat should work end-to-end here.",
      );
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
