import { redirect } from "next/navigation";
import { getClientAuthState } from "@/lib/client-auth";
import { enterClientAreaAction } from "./actions";
import { ClientDoor, DoorButton } from "../door";

export const metadata = { title: "Open my cleans", robots: { index: false, follow: false } };

/**
 * Where the emailed link lands: one button. Pressing it signs the client in
 * (see ./actions.ts for why the link doesn't do that by itself).
 */
export default async function EnterPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const token = typeof t === "string" ? t : "";

  // Already in, on this device: nothing to press.
  const state = await getClientAuthState();
  if (state.status === "ok") redirect("/client");
  if (!token) redirect("/client/login");

  return (
    <ClientDoor title="You're almost in" lede="Press the button to see your cleans.">
      <form action={enterClientAreaAction}>
        <input type="hidden" name="t" value={token} />
        <DoorButton>Open my cleans</DoorButton>
      </form>
    </ClientDoor>
  );
}
