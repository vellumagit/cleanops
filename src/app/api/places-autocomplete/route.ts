/**
 * Server-side proxy for Google Places Autocomplete (New API).
 * Keeps GOOGLE_PLACES_API_KEY out of the browser bundle.
 *
 * GET /api/places-autocomplete?q=<query>
 * Returns: { suggestions: [{ placeId, text }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { rateLimitByIp } from "@/lib/rate-limit-helpers";

const PLACES_URL = "https://places.googleapis.com/v1/places:autocomplete";

export async function GET(request: NextRequest) {
  // Require a signed-in user — this proxy spends GOOGLE_PLACES_API_KEY, so it
  // must not be an open endpoint anyone on the internet can drive up billing on.
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Cap per-IP request volume as defence-in-depth against a compromised session
  // scripting the proxy. 60/min is generous for interactive address typing.
  const limited = await rateLimitByIp(request, "places-autocomplete", 60, 60_000);
  if (limited) return limited;

  const q = request.nextUrl.searchParams.get("q") ?? "";
  if (q.trim().length < 3) {
    return NextResponse.json({ suggestions: [] });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error("[places] GOOGLE_PLACES_API_KEY not set");
    return NextResponse.json({ suggestions: [] });
  }

  try {
    const res = await fetch(PLACES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "suggestions.placePrediction.text,suggestions.placePrediction.placeId",
      },
      body: JSON.stringify({
        input: q,
        includedRegionCodes: ["ca", "us"],
        types: ["address"],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[places] API error ${res.status}: ${body}`);
      return NextResponse.json({ suggestions: [] });
    }

    const data = await res.json();

    // Normalise to { placeId, text } pairs
    const suggestions = (data.suggestions ?? []).map(
      (s: {
        placePrediction: { placeId: string; text: { text: string } };
      }) => ({
        placeId: s.placePrediction.placeId,
        text: s.placePrediction.text.text,
      }),
    );

    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error("[places] fetch failed:", err);
    return NextResponse.json({ suggestions: [] });
  }
}
