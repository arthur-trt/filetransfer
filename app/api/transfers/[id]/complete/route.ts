import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  completeMultipart,
  headObject,
  transferKey,
} from "@/lib/r2";
import { CompleteTransferSchema } from "@/lib/validation";
import { Prisma } from "@prisma/client";
import { errorResponse, jsonNoStore } from "@/lib/http";
import { sendTransferEmail } from "@/lib/email/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "invalid_json");
  }
  const parsed = CompleteTransferSchema.safeParse(body);
  if (!parsed.success) return errorResponse(400, "validation_failed");

  const transfer = await prisma.transfer.findUnique({
    where: { id },
    select: {
      id: true,
      completed: true,
      revoked: true,
      expiresAt: true,
      fileCount: true,
      totalBytes: true,
      multipartIds: true,
      pendingRecipient: true,
      pendingMessage: true,
    },
  });
  if (!transfer) return errorResponse(404, "not_found");
  if (transfer.revoked) return errorResponse(410, "revoked");
  if (transfer.completed) return errorResponse(409, "already_completed");

  const ids = (transfer.multipartIds as Record<string, string> | null) ?? {};

  for (const entry of parsed.data.files) {
    const key = transferKey(id, String(entry.fileIndex));
    const uploadId = ids[String(entry.fileIndex)];
    if (uploadId) {
      if (!entry.parts || entry.parts.length === 0) {
        return errorResponse(400, "missing_parts_for_multipart");
      }
      const parts = [...entry.parts]
        .sort((a, b) => a.partNumber - b.partNumber)
        .map((p) => ({ PartNumber: p.partNumber, ETag: p.eTag }));
      await completeMultipart(key, uploadId, parts);
    } else {
      const exists = await headObject(key);
      if (!exists) return errorResponse(400, "object_missing");
    }
  }

  const manifestExists = await headObject(
    transferKey(id, "manifest.json.enc"),
  );
  if (!manifestExists) return errorResponse(400, "manifest_missing");

  await prisma.transfer.update({
    where: { id },
    data: {
      completed: true,
      multipartIds: Prisma.JsonNull,
      pendingRecipient: null,
      pendingMessage: null,
    },
  });

  if (transfer.pendingRecipient) {
    sendTransferEmail({
      to: transfer.pendingRecipient,
      shareUrl: parsed.data.shareUrl,
      message: transfer.pendingMessage,
      fileCount: transfer.fileCount,
      totalBytes: Number(transfer.totalBytes),
      expiresAt: transfer.expiresAt,
    }).catch((err) => {
      console.error("[email] delivery failed", { id, err: String(err) });
    });
  }

  return jsonNoStore({ ok: true });
}
