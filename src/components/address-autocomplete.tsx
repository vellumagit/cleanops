"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { MapPin, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Address autocomplete input backed by OpenStreetMap Nominatim.
 * Free, no API key required. Drop-in replacement for a plain <Input>
 * when you want real-address suggestions.
 *
 * Usage:
 *   <AddressAutocomplete
 *     id="address"
 *     name="address"
 *     value={addressValue}
 *     onChange={setAddressValue}
 *   />
 *
 * Note: Nominatim terms require a descriptive User-Agent and max 1 req/s.
 * We debounce at 400ms which comfortably satisfies the rate limit.
 *
 * Upgrade path: swap `searchNominatim` for a Google Places call when a
 * Places API key is available — the component interface stays identical.
 */

type Suggestion = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
};

async function searchNominatim(query: string): Promise<Suggestion[]> {
  if (query.trim().length < 5) return [];
  const params = new URLSearchParams({
    q: query,
    format: "json",
    addressdetails: "0",
    limit: "5",
    countrycodes: "ca,us",
  });
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    {
      headers: {
        "Accept-Language": "en",
        "User-Agent": "Sollos/3 (sollos.app)",
      },
    },
  );
  if (!res.ok) return [];
  return res.json() as Promise<Suggestion[]>;
}

export function AddressAutocomplete({
  id,
  name,
  value,
  onChange,
  placeholder,
  className,
  required,
  disabled,
}: {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await searchNominatim(q);
        setSuggestions(results);
        setOpen(results.length > 0);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 400);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    onChange(v);
    setHighlightedIdx(-1);
    if (v.length >= 5) {
      search(v);
    } else {
      setSuggestions([]);
      setOpen(false);
    }
  }

  function selectSuggestion(suggestion: Suggestion) {
    // Nominatim returns the full display_name — truncate the trailing
    // country for a cleaner result (everything before the last ", Canada"
    // or ", United States").
    const parts = suggestion.display_name.split(", ");
    const last = parts[parts.length - 1];
    const trimmed =
      last === "Canada" || last === "United States"
        ? parts.slice(0, -1).join(", ")
        : suggestion.display_name;
    onChange(trimmed);
    setSuggestions([]);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && highlightedIdx >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[highlightedIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          id={id}
          name={name}
          type="text"
          autoComplete="off"
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder ?? "Start typing an address…"}
          required={required}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 pr-8 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        />
        <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MapPin className="h-3.5 w-3.5" />
          )}
        </div>
      </div>

      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-lg text-sm">
          {suggestions.map((s, idx) => (
            <li key={s.place_id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // keep input focused
                  selectSuggestion(s);
                }}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-left text-sm",
                  idx === highlightedIdx
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50",
                )}
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="leading-snug">{s.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
