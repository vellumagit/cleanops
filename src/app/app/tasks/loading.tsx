import { SectionLoading } from "@/components/section-loading";

// In-shell wait. Without it this section fell through to /app/loading.tsx,
// the full-screen boot splash.
export default function Loading() {
  return <SectionLoading title="Tasks & Reminders" />;
}
