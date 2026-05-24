/**
 * Server-side proxy for Google Places Autocomplete (New API).
 * Keeps GOOGLE_PLACES_API_KEY out of the browser bundle.
 *
 * GET /api/places-autocomplete?q=<query>
 * Returns: { suggestions: [{ placeId, text }] }
 */

import { NextRequest, NextResponse } from "next/server";

const PLACES_URL = "https://places.googleapis.com/v1/places:autocomplete";

export async function GET(request: NextRequest) {
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
