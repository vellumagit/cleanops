/**
 * Minimal layout for unauthenticated client-portal pages — login and
 * claim. Purely a passthrough so these pages skip the tab-bar chrome
 * applied to the (portal) route group.
 */
export default function ClientPublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
