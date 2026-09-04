import { ExternalLink, PlayCircle } from "lucide-react";

/**
 * A training step's link, rendered the way the cleaner needs it: a
 * YouTube or Vimeo link becomes the player itself, right under the
 * instructions; anything else is a button that opens in a new tab with
 * the host named, so nobody taps into a surprise.
 *
 * Server-safe, no state. Embed detection is deliberately narrow — two
 * hosts we know render well in an iframe — everything else links out.
 */

export function parseEmbed(
  url: string,
): { kind: "youtube" | "vimeo"; src: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const id =
      u.searchParams.get("v") ??
      u.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{6,})/)?.[1] ??
      null;
    if (id) {
      return {
        kind: "youtube",
        src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`,
      };
    }
  }
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    if (/^[A-Za-z0-9_-]{6,}$/.test(id)) {
      return {
        kind: "youtube",
        src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`,
      };
    }
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = u.pathname.match(/(\d{6,})/)?.[1];
    if (id) {
      return { kind: "vimeo", src: `https://player.vimeo.com/video/${id}` };
    }
  }
  return null;
}

export function TrainingStepLink({
  url,
  label,
}: {
  url: string;
  /** Accessible name for the player / button. */
  label: string;
}) {
  const embed = parseEmbed(url);
  if (embed) {
    return (
      <div className="mt-2 overflow-hidden rounded-md border border-border bg-black">
        <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
          <iframe
            src={embed.src}
            title={label}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 bg-card px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <PlayCircle className="h-3.5 w-3.5" />
          Open on {embed.kind === "youtube" ? "YouTube" : "Vimeo"}
        </a>
      </div>
    );
  }

  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // leave the raw url as the caption
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
    >
      <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate">Open link</span>
      <span className="truncate text-xs font-normal text-muted-foreground">
        {host}
      </span>
    </a>
  );
}
