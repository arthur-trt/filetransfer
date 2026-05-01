import { z } from "zod";

export const MAX_FILE_BYTES = 50 * 1024 ** 3;
export const MAX_TRANSFER_BYTES = 100 * 1024 ** 3;
export const MAX_FILES_PER_TRANSFER = 100;
export const MAX_MESSAGE_LEN = 2000;
export const MAX_RECIPIENTS = 10;
export const MULTIPART_THRESHOLD = 100 * 1024 * 1024;
export const MULTIPART_PART_SIZE = 32 * 1024 * 1024;

export const TtlSchema = z.enum(["1d", "7d", "30d"]);
export type Ttl = z.infer<typeof TtlSchema>;

export const DownloadCapSchema = z.union([
  z.literal(1),
  z.literal(5),
  z.literal(25),
  z.null(),
]);

export const KdfParamsSchema = z.object({
  alg: z.literal("argon2id"),
  m: z.number().int().positive(),
  t: z.number().int().positive(),
  p: z.number().int().positive(),
});

export const PasswordBundleSchema = z.object({
  salt: z.string().min(1),
  wrappedKey: z.string().min(1),
  kdfParams: KdfParamsSchema,
});

export const CreateTransferSchema = z
  .object({
    files: z
      .array(
        z.object({
          sizeBytes: z
            .number()
            .int()
            .nonnegative()
            .max(MAX_FILE_BYTES, "File exceeds 50 GB limit"),
          mode: z.enum(["single", "multipart"]),
        }),
      )
      .min(1)
      .max(MAX_FILES_PER_TRANSFER),
    manifestSize: z.number().int().positive().max(5 * 1024 * 1024),
    password: PasswordBundleSchema.nullable().optional(),
    ttl: TtlSchema,
    downloadCap: DownloadCapSchema,
    recipientEmails: z
      .array(z.string().email())
      .max(MAX_RECIPIENTS, `At most ${MAX_RECIPIENTS} recipients allowed`)
      .optional()
      .nullable(),
    senderMessage: z.string().max(MAX_MESSAGE_LEN).optional().nullable(),
  })
  .refine(
    (v) => v.files.reduce((n, f) => n + f.sizeBytes, 0) <= MAX_TRANSFER_BYTES,
    { message: "Transfer exceeds 100 GB total" },
  )
  .refine(
    (v) =>
      v.files.every((f) =>
        f.mode === "multipart"
          ? f.sizeBytes > MULTIPART_THRESHOLD
          : f.sizeBytes <= MULTIPART_THRESHOLD,
      ),
    { message: "File mode doesn't match size threshold" },
  );
export type CreateTransferInput = z.infer<typeof CreateTransferSchema>;

export const PartsRequestSchema = z.object({
  fileIndex: z.number().int().nonnegative(),
  partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(100),
});

export const CompleteTransferSchema = z.object({
  files: z
    .array(
      z.object({
        fileIndex: z.number().int().nonnegative(),
        parts: z
          .array(
            z.object({
              partNumber: z.number().int().min(1).max(10_000),
              eTag: z.string().min(1),
            }),
          )
          .optional(),
      }),
    )
    .min(1),
  shareUrl: z.string().url(),
});

export const NotifySchema = z.object({
  shareUrl: z.string().url(),
  recipientEmail: z.string().email(),
  senderMessage: z.string().max(MAX_MESSAGE_LEN).optional().nullable(),
});

export function ttlToExpires(ttl: Ttl): Date {
  const ms =
    ttl === "1d"
      ? 86_400_000
      : ttl === "7d"
        ? 7 * 86_400_000
        : 30 * 86_400_000;
  return new Date(Date.now() + ms);
}

const ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newTransferId(): string {
  const rand = new Uint8Array(10);
  crypto.getRandomValues(rand);
  let s = "";
  for (let i = 0; i < rand.length; i++) {
    s += ID_ALPHABET[rand[i] % ID_ALPHABET.length];
  }
  return s;
}
