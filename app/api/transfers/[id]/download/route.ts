import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { presignGet, transferKey } from "@/lib/r2";
import { errorResponse, jsonNoStore } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.transfer.findUnique({
      where: { id },
      select: {
        id: true,
        fileCount: true,
        completed: true,
        revoked: true,
        expiresAt: true,
        downloadCap: true,
        downloadCount: true,
      },
    });
    if (!t || !t.completed) return { kind: "not_found" as const };
    if (t.revoked) return { kind: "revoked" as const };
    if (t.expiresAt.getTime() < Date.now())
      return { kind: "expired" as const };
    if (t.downloadCap != null && t.downloadCount >= t.downloadCap) {
      return { kind: "exhausted" as const };
    }
    await tx.transfer.update({
      where: { id },
      data: { downloadCount: { increment: 1 } },
    });
    return { kind: "ok" as const, fileCount: t.fileCount };
  });

  if (updated.kind === "not_found") return errorResponse(404, "not_found");
  if (updated.kind === "revoked") return errorResponse(410, "revoked");
  if (updated.kind === "expired") return errorResponse(410, "expired");
  if (updated.kind === "exhausted") return errorResponse(410, "exhausted");

  const manifestUrl = await presignGet(transferKey(id, "manifest.json.enc"));
  const files: { fileIndex: number; url: string }[] = [];
  for (let i = 0; i < updated.fileCount; i++) {
    files.push({
      fileIndex: i,
      url: await presignGet(transferKey(id, String(i))),
    });
  }
  return jsonNoStore({ manifestUrl, files });
}
