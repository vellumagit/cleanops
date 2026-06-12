"use client";

import { useEffect, useState, type ReactNode } from "react";
import { appleMapsUrl, googleMapsUrl } from "@/lib/maps";

/**
 * "Open in Maps" link that targets the right app for the device: Apple
 * Maps on iPhone / iPad / Mac, Google Maps everywhere else.
 *
 * Renders the Google Maps URL on the server and first client paint (so SSR
 * and hydration match), then swaps to Apple Maps after mount on Apple
 * platforms. Keeps a single button — no platform guessing by the user.
 *
 * Pass `className` + `children` to match each call site's existing styling
 * and label.
 */
export function OpenInMaps({
  address,
  className,
  children,
}: {
  address: string;
  className?: string;
  children?: ReactNode;
}) {
  const [isApple, setIsApple] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || "";
    // iPhone/iPad/iPod are unambiguous. iPadOS 13+ and desktop Macs report
    // as "Macintosh" / "Mac OS X" — those have Apple Maps too, so route them
    // there as well. Reading navigator only works post-mount, so a one-time
    // setState in this effect is the intended pattern here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsApple(/iPhone|iPad|iPod|Macintosh|Mac OS X/.test(ua));
  }, []);

  const href = isApple ? appleMapsUrl(address) : googleMapsUrl(address);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children ?? "Open in Maps"}
    </a>
  );
}
