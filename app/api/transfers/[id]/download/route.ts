import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { presignGet, transferKey } from "@/lib/r2";
import { errorResponse, jsonNoStore } from "@/lib/http";
import { bytesToB64u } from "@/lib/crypto/encode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_TTL_MS = 60 * 60 * 1000;

function newSessionToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToB64u(bytes);
}

type Request = { resumeToken?: string };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: Request = {};
  if (req.headers.get("content-length") && req.headers.get("content-length") !== "0") {
    try {
      body = (await req.json()) as Request;
    } catch {
      // Accept empty/garbage bodies — equivalent to no resume token.
    }
  }

  const resumeToken =
    typeof body.resumeToken === "string" && body.resumeToken.length > 0
      ? body.resumeToken
      : null;

  const result = await prisma.$transaction(async (tx) => {
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

    // Resume path: existing valid session → touch lastSeenAt, skip counter.
    if (resumeToken) {
      const existing = await tx.downloadSession.findUnique({
        where: { token: resumeToken },
        select: { transferId: true, createdAt: true },
      });
      if (
        existing &&
        existing.transferId === id &&
        Date.now() - existing.createdAt.getTime() < SESSION_TTL_MS
      ) {
        await tx.downloadSession.update({
          where: { token: resumeToken },
          data: { lastSeenAt: new Date() },
        });
        return {
          kind: "ok" as const,
          fileCount: t.fileCount,
          token: resumeToken,
        };
      }
      // Token unknown or expired — fall through to new-session path. Still
      // subject to cap check below.
    }

    if (t.downloadCap != null && t.downloadCount >= t.downloadCap) {
      return { kind: "exhausted" as const };
    }

    await tx.transfer.update({
      where: { id },
      data: { downloadCount: { increment: 1 } },
    });
    const token = newSessionToken();
    await tx.downloadSession.create({
      data: { token, transferId: id },
    });
    return { kind: "ok" as const, fileCount: t.fileCount, token };
  });

  if (result.kind === "not_found") return errorResponse(404, "not_found");
  if (result.kind === "revoked") return errorResponse(410, "revoked");
  if (result.kind === "expired") return errorResponse(410, "expired");
  if (result.kind === "exhausted") return errorResponse(410, "exhausted");

  const manifestUrl = await presignGet(transferKey(id, "manifest.json.enc"));
  const files: { fileIndex: number; url: string }[] = [];
  for (let i = 0; i < result.fileCount; i++) {
    files.push({
      fileIndex: i,
      url: await presignGet(transferKey(id, String(i))),
    });
  }
  return jsonNoStore({
    manifestUrl,
    files,
    resumeToken: result.token,
  });
}
