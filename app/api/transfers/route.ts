import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  createMultipart,
  presignPut,
  presignUploadPart,
  transferKey,
} from "@/lib/r2";
import {
  CreateTransferSchema,
  MULTIPART_PART_SIZE,
  newTransferId,
  ttlToExpires,
} from "@/lib/validation";
import { clientIp, errorResponse, jsonNoStore, truncateIp } from "@/lib/http";
import { b64uToBytes } from "@/lib/crypto/encode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UploadSpec =
  | {
      fileIndex: number;
      mode: "single";
      key: string;
      putUrl: string;
    }
  | {
      fileIndex: number;
      mode: "multipart";
      key: string;
      uploadId: string;
      partCount: number;
      partUrls: { partNumber: number; url: string }[];
    };

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "invalid_json");
  }
  const parsed = CreateTransferSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "validation_failed",
      parsed.error.issues[0]?.message,
    );
  }
  const input = parsed.data;

  const id = newTransferId();
  const expiresAt = ttlToExpires(input.ttl);
  const totalBytes = input.files.reduce((n, f) => n + f.sizeBytes, 0);

  const manifestKey = transferKey(id, "manifest.json.enc");
  const r2Keys: string[] = [manifestKey];
  const multipartIds: Record<string, string> = {};
  const uploads: UploadSpec[] = [];

  const manifestPut = await presignPut(manifestKey);

  for (let i = 0; i < input.files.length; i++) {
    const f = input.files[i];
    const key = transferKey(id, String(i));
    r2Keys.push(key);
    if (f.mode === "single") {
      const putUrl = await presignPut(key);
      uploads.push({ fileIndex: i, mode: "single", key, putUrl });
    } else {
      const uploadId = await createMultipart(key);
      multipartIds[String(i)] = uploadId;
      const partCount = Math.ceil(f.sizeBytes / MULTIPART_PART_SIZE);
      const firstBatch = Math.min(partCount, 5);
      const partUrls: { partNumber: number; url: string }[] = [];
      for (let p = 1; p <= firstBatch; p++) {
        partUrls.push({
          partNumber: p,
          url: await presignUploadPart(key, uploadId, p),
        });
      }
      uploads.push({
        fileIndex: i,
        mode: "multipart",
        key,
        uploadId,
        partCount,
        partUrls,
      });
    }
  }

  let pwSalt: Buffer | null = null;
  let pwWrappedKey: Buffer | null = null;
  let pwKdfParams: { alg: "argon2id"; m: number; t: number; p: number } | null =
    null;
  if (input.password) {
    pwSalt = Buffer.from(b64uToBytes(input.password.salt));
    pwWrappedKey = Buffer.from(b64uToBytes(input.password.wrappedKey));
    pwKdfParams = input.password.kdfParams;
  }

  const ip = truncateIp(clientIp(req));

  await prisma.transfer.create({
    data: {
      id,
      expiresAt,
      fileCount: input.files.length,
      totalBytes: BigInt(totalBytes),
      pwSalt,
      pwWrappedKey,
      pwKdfParams: pwKdfParams ?? undefined,
      hasPassword: !!input.password,
      downloadCap: input.downloadCap ?? null,
      senderIp: ip,
      r2Keys,
      multipartIds:
        Object.keys(multipartIds).length > 0 ? multipartIds : undefined,
      emailedTo: !!input.recipientEmail,
      pendingRecipient: input.recipientEmail ?? null,
      pendingMessage: input.senderMessage ?? null,
    },
  });

  return jsonNoStore({
    id,
    expiresAt: expiresAt.toISOString(),
    manifestUpload: { key: manifestKey, putUrl: manifestPut },
    uploads,
  });
}
