export async function readRequestBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const body: Record<string, unknown> = {};
      for (const [key, value] of formData.entries()) {
        body[key] = typeof value === "string" ? value : "";
      }
      return body;
    }

    const raw = await request.text();
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      const body: Record<string, unknown> = {};
      for (const [key, value] of new URLSearchParams(raw).entries()) {
        body[key] = value;
      }
      return body;
    }
  } catch {
    return {};
  }
}
