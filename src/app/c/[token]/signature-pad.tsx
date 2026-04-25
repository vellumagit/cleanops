"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Simple <canvas> signature pad. Pointer events cover mouse + touch +
 * stylus uniformly so we don't have to branch on input type.
 *
 * Rendering strategy:
 *   - The canvas backing store is sized to (width × DPR, height × DPR)
 *     so strokes stay crisp on high-DPI screens. CSS keeps the visual
 *     size at width × height.
 *   - Strokes are drawn directly to the backing store. We never repaint
 *     from a stroke history — this matches the natural feel of pen on
 *     paper (you can't undo a stroke without redrawing) and keeps the
 *     hot path tiny on mobile.
 *
 * Output: emits a PNG data URL via `onChange` on every stroke end (and
 * empty string when cleared) so the parent form can stash the latest
 * value in a hidden input.
 */
export function SignaturePad({
  width = 480,
  height = 160,
  onChange,
  ariaLabel = "Signature canvas",
}: {
  width?: number;
  height?: number;
  /** Fires after each stroke (and on clear). Empty string means no
   *  ink — useful for "did the user actually draw something?" checks. */
  onChange: (dataUrl: string) => void;
  ariaLabel?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  // Initialize the backing store at device pixel density. Re-runs only
  // if width/height change (rare — typically constant per mount).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    // Use the document's foreground color so the line reads in both
    // light + dark themes. Fall back to near-black if we can't read it.
    const root = getComputedStyle(document.documentElement);
    ctx.strokeStyle = root.getPropertyValue("--foreground").trim()
      ? `hsl(${root.getPropertyValue("--foreground")})`
      : "#0f172a";
  }, [width, height]);

  const pointFromEvent = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * width,
        y: ((e.clientY - rect.top) / rect.height) * height,
      };
    },
    [width, height],
  );

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPointRef.current = pointFromEvent(e);
    // A single tap should leave a visible dot — draw a tiny segment
    // from the point to itself.
    const ctx = canvas.getContext("2d");
    if (ctx && lastPointRef.current) {
      ctx.beginPath();
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
      ctx.lineTo(lastPointRef.current.x + 0.01, lastPointRef.current.y);
      ctx.stroke();
    }
    e.preventDefault();
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const next = pointFromEvent(e);
    const last = lastPointRef.current;
    if (!last) return;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    lastPointRef.current = next;
  }

  function endStroke() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setHasInk(true);
    onChange(canvas.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // The 2D context was already scaled by DPR, so clear in logical
    // (CSS) pixel space — multiplying by DPR again would over-clear,
    // but ctx.clearRect respects the current transform.
    ctx.clearRect(0, 0, width, height);
    setHasInk(false);
    onChange("");
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-md border border-border bg-background">
        <canvas
          ref={canvasRef}
          aria-label={ariaLabel}
          role="img"
          className="block w-full touch-none cursor-crosshair"
          style={{ maxWidth: width, height }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          Sign with your finger, stylus, or mouse.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={clear}
          disabled={!hasInk}
        >
          <Eraser className="h-3.5 w-3.5" />
          Clear
        </Button>
      </div>
    </div>
  );
}
