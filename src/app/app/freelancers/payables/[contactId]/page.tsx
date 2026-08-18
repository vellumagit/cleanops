import { redirect } from "next/navigation";

/** Per-payee ledger moved with its parent — see ../page.tsx. */
export default async function LegacyPayeeRedirect({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const { contactId } = await params;
  redirect(`/app/payroll/contractors/${contactId}`);
}
