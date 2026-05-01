import { NextResponse } from "next/server";

export function jsonNoStore<T>(body: T, init?: ResponseInit): NextResponse {
  const res = NextResponse.json(body as object, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export function errorResponse(
  status: number,
  code: string,
  message?: string,
): NextResponse {
  return jsonNoStore({ error: { code, message } }, { status });
}

export function truncateIp(ip: string | null): string | null {
  if (!ip) return null;
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return parts.slice(0, 3).join(":") + "::";
  }
  const parts = ip.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  return null;
}

export function clientIp(req: Request): string | null {
  const h = req.headers;
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? null;
}
