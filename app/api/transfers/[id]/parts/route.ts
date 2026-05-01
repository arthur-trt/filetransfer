import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { presignUploadPart, transferKey } from "@/lib/r2";
import { PartsRequestSchema } from "@/lib/validation";
import { errorResponse, jsonNoStore } from "@/lib/http";

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
  const parsed = PartsRequestSchema.safeParse(body);
  if (!parsed.success) return errorResponse(400, "validation_failed");

  const transfer = await prisma.transfer.findUnique({
    where: { id },
    select: {
      multipartIds: true,
      completed: true,
      revoked: true,
      expiresAt: true,
    },
  });
  if (!transfer) return errorResponse(404, "not_found");
  if (transfer.completed) return errorResponse(409, "already_completed");
  if (transfer.revoked) return errorResponse(410, "revoked");
  if (transfer.expiresAt.getTime() < Date.now()) {
    return errorResponse(410, "expired");
  }

  const ids = transfer.multipartIds as Record<string, string> | null;
  const uploadId = ids?.[String(parsed.data.fileIndex)];
  if (!uploadId) return errorResponse(400, "no_multipart_for_file");

  const key = transferKey(id, String(parsed.data.fileIndex));
  const urls = await Promise.all(
    parsed.data.partNumbers.map(async (partNumber) => ({
      partNumber,
      url: await presignUploadPart(key, uploadId, partNumber),
    })),
  );

  return jsonNoStore({ urls });
}
