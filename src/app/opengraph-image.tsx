import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Sollos 3 — Operations software for cleaning companies";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          background:
            "linear-gradient(135deg, #0a0a0f 0%, #1a1333 50%, #0a0a0f 100%)",
          color: "white",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        {/* subtle dot pattern */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1px, transparent 0)",
            backgroundSize: "24px 24px",
          }}
        />

        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background:
                "linear-gradient(135deg, #818cf8 0%, #a78bfa 50%, #f472b6 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
              fontWeight: 800,
              color: "#0a0a0f",
            }}
          >
            S
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            Sollos 3
          </div>
        </div>

        {/* headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 72,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              maxWidth: 1000,
            }}
          >
            Operations software for cleaning companies.
          </div>
          <div
            style={{
              fontSize: 30,
              color: "rgba(255,255,255,0.7)",
              lineHeight: 1.3,
              maxWidth: 900,
            }}
          >
            Bookings, scheduling, invoicing, team chat, and a freelancer
            bench — in one place.
          </div>
        </div>

        {/* footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 22,
            color: "rgba(255,255,255,0.55)",
          }}
        >
          <div style={{ display: "flex" }}>14-day free trial · No credit card</div>
          <div style={{ display: "flex" }}>sollos3.com</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
