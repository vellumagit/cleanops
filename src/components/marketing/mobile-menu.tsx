"use client";

import { useRef } from "react";
import { Menu, X } from "lucide-react";

/**
 * The phone-width menu for the public header. A <details> element, so it
 * opens without JavaScript; the only script is closing it again when a link
 * inside is tapped (an in-page anchor would otherwise leave it covering the
 * section it just scrolled to).
 */
export function MobileMenu({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details ref={ref} className="group md:hidden">
      <summary
        className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full text-zinc-700 hover:bg-zinc-100 [&::-webkit-details-marker]:hidden"
        aria-label="Menu"
      >
        <Menu className="h-5 w-5 group-open:hidden" />
        <X className="hidden h-5 w-5 group-open:block" />
      </summary>
      <div
        className="absolute inset-x-0 top-full border-b border-zinc-200 bg-white px-4 pb-5 pt-2 shadow-lg"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) ref.current?.removeAttribute("open");
        }}
      >
        {children}
      </div>
    </details>
  );
}
