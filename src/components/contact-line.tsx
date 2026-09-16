import { Mail, MapPin, Phone } from "lucide-react";

/**
 * A person's ways of being reached, on one line: email (mailto), phone
 * (tel), address. Renders nothing when there is nothing to show.
 *
 * Built for the three places a website inquiry lands — Requests, the
 * Estimates list, the estimate itself — which until 2026-09-15 showed only
 * the name, so the email and phone the visitor typed were reachable only by
 * clicking through to Leads. Same data, every surface. Server-safe: no
 * hooks, so client and server components can both render it.
 */
export function ContactLine({
  email,
  phone,
  address,
  className = "",
}: {
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  className?: string;
}) {
  const e = email?.trim();
  const p = phone?.trim();
  const a = address?.trim();
  if (!e && !p && !a) return null;
  const item = "inline-flex min-w-0 items-center gap-1";
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground ${className}`}
    >
      {e && (
        <a href={`mailto:${e}`} className={`${item} hover:text-foreground hover:underline`}>
          <Mail className="h-3 w-3 shrink-0" />
          <span className="truncate">{e}</span>
        </a>
      )}
      {p && (
        <a href={`tel:${p}`} className={`${item} hover:text-foreground hover:underline`}>
          <Phone className="h-3 w-3 shrink-0" />
          <span className="truncate">{p}</span>
        </a>
      )}
      {a && (
        <span className={item} title={a}>
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{a}</span>
        </span>
      )}
    </div>
  );
}
