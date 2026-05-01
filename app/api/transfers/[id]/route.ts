import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { abortMultipart, deletePrefix, transferKey } from "@/lib/r2";
import { errorResponse, jsonNoStore } from "@/lib/http";
import { auth } from "@/lib/auth";
import { bytesToB64u } from "@/lib/crypto/encode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const t = await prisma.transfer.findUnique({
    where: { id },
    select: {
      id: true,
      completed: true,
      revoked: true,
      expiresAt: true,
      fileCount: true,
      totalBytes: true,
      hasPassword: true,
      downloadCap: true,
      downloadCount: true,
      pwSalt: true,
      pwWrappedKey: true,
      pwKdfParams: true,
    },
  });
  if (!t || !t.completed) return errorResponse(404, "not_found");

  const expired = t.expiresAt.getTime() < Date.now();
  const exhausted = t.downloadCap != null && t.downloadCount >= t.downloadCap;
  const state: "ready" | "expired" | "revoked" | "exhausted" = t.revoked
    ? "revoked"
    : expired
      ? "expired"
      : exhausted
        ? "exhausted"
        : "ready";

  const body: Record<string, unknown> = {
    id: t.id,
    state,
    fileCount: t.fileCount,
    totalBytes: Number(t.totalBytes),
    expiresAt: t.expiresAt.toISOString(),
    hasPassword: t.hasPassword,
    downloadsRemaining:
      t.downloadCap == null
        ? null
        : Math.max(0, t.downloadCap - t.downloadCount),
  };

  if (t.hasPassword && t.pwSalt && t.pwWrappedKey && t.pwKdfParams) {
    body.passwordBundle = {
      salt: bytesToB64u(new Uint8Array(t.pwSalt)),
      wrappedKey: bytesToB64u(new Uint8Array(t.pwWrappedKey)),
      kdfParams: t.pwKdfParams,
    };
  }
  return jsonNoStore(body);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const t = await prisma.transfer.findUnique({
    where: { id },
    select: {
      id: true,
      revoked: true,
      completed: true,
      multipartIds: true,
    },
  });
  if (!t) return errorResponse(404, "not_found");

  if (t.completed) {
    const session = await auth();
    const email = (session?.user?.email ?? "").trim().toLowerCase();
    const admin = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
    if (!email || email !== admin) return errorResponse(401, "unauthorized");
  }

  if (!t.completed && t.multipartIds) {
    const ids = t.multipartIds as Record<string, string>;
    for (const [fileIndex, uploadId] of Object.entries(ids)) {
      await abortMultipart(transferKey(id, fileIndex), uploadId).catch(
        () => {},
      );
    }
  }

  await deletePrefix(`transfers/${id}/`);
  await prisma.transfer.update({
    where: { id },
    data: {
      revoked: true,
      completed: true,
      multipartIds: Prisma.JsonNull,
    },
  });
  return jsonNoStore({ ok: true });
}
