import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  abortMultipart,
  deletePrefix,
  transferKey,
} from "@/lib/r2";
import { errorResponse, jsonNoStore } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_INCOMPLETE_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return errorResponse(401, "unauthorized");
  }

  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_INCOMPLETE_MS);

  const expired = await prisma.transfer.findMany({
    where: {
      revoked: false,
      OR: [
        { expiresAt: { lt: now } },
        { completed: false, createdAt: { lt: staleBefore } },
      ],
    },
    select: { id: true, completed: true, multipartIds: true },
    take: 100,
  });

  let swept = 0;
  for (const t of expired) {
    try {
      if (!t.completed && t.multipartIds) {
        const ids = t.multipartIds as Record<string, string>;
        for (const [fileIndex, uploadId] of Object.entries(ids)) {
          await abortMultipart(transferKey(t.id, fileIndex), uploadId).catch(
            () => {},
          );
        }
      }
      await deletePrefix(`transfers/${t.id}/`);
      await prisma.transfer.update({
        where: { id: t.id },
        data: {
          revoked: true,
          completed: true,
          multipartIds: Prisma.JsonNull,
        },
      });
      swept++;
    } catch (err) {
      console.error("[sweep] failed", { id: t.id, err: String(err) });
    }
  }

  return jsonNoStore({ swept });
}
