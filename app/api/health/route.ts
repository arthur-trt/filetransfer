export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", {
    headers: { "cache-control": "no-store", "content-type": "text/plain" },
  });
}
