import { describe, it, expect } from "vitest";
import {
  CreateTransferSchema,
  MAX_FILE_BYTES,
  MAX_TRANSFER_BYTES,
  MAX_FILES_PER_TRANSFER,
  MAX_MESSAGE_LEN,
  MULTIPART_THRESHOLD,
  PartsRequestSchema,
  CompleteTransferSchema,
  NotifySchema,
  ttlToExpires,
  newTransferId,
} from "@/lib/validation";

const validBase = {
  files: [{ sizeBytes: 1_000_000, mode: "single" as const }],
  manifestSize: 512,
  ttl: "7d" as const,
  downloadCap: null,
};

describe("CreateTransferSchema", () => {
  it("accepts a minimal valid payload", () => {
    expect(CreateTransferSchema.safeParse(validBase).success).toBe(true);
  });

  it("rejects empty files[]", () => {
    expect(
      CreateTransferSchema.safeParse({ ...validBase, files: [] }).success,
    ).toBe(false);
  });

  it("rejects more than MAX_FILES_PER_TRANSFER", () => {
    const many = Array.from({ length: MAX_FILES_PER_TRANSFER + 1 }, () => ({
      sizeBytes: 1,
      mode: "single" as const,
    }));
    expect(
      CreateTransferSchema.safeParse({ ...validBase, files: many }).success,
    ).toBe(false);
  });

  it("rejects a single file over 50 GB", () => {
    expect(
      CreateTransferSchema.safeParse({
        ...validBase,
        files: [{ sizeBytes: MAX_FILE_BYTES + 1, mode: "multipart" }],
      }).success,
    ).toBe(false);
  });

  it("accepts a file at exactly 50 GB", () => {
    expect(
      CreateTransferSchema.safeParse({
        ...validBase,
        files: [{ sizeBytes: MAX_FILE_BYTES, mode: "multipart" }],
      }).success,
    ).toBe(true);
  });

  it("rejects total over 100 GB across multiple files", () => {
    const files = [
      { sizeBytes: MAX_FILE_BYTES, mode: "multipart" as const },
      { sizeBytes: MAX_FILE_BYTES, mode: "multipart" as const },
      { sizeBytes: 1, mode: "single" as const },
    ];
    const total = files.reduce((n, f) => n + f.sizeBytes, 0);
    expect(total).toBeGreaterThan(MAX_TRANSFER_BYTES);
    expect(
      CreateTransferSchema.safeParse({ ...validBase, files }).success,
    ).toBe(false);
  });

  it("rejects mode=single above the multipart threshold", () => {
    expect(
      CreateTransferSchema.safeParse({
        ...validBase,
        files: [{ sizeBytes: MULTIPART_THRESHOLD + 1, mode: "single" }],
      }).success,
    ).toBe(false);
  });

  it("rejects mode=multipart below or at the threshold", () => {
    expect(
      CreateTransferSchema.safeParse({
        ...validBase,
        files: [{ sizeBytes: MULTIPART_THRESHOLD, mode: "multipart" }],
      }).success,
    ).toBe(false);
  });

  it("rejects invalid TTL values", () => {
    expect(
      CreateTransferSchema.safeParse({ ...validBase, ttl: "forever" }).success,
    ).toBe(false);
  });

  it("rejects non-allowlisted download caps", () => {
    expect(
      CreateTransferSchema.safeParse({ ...validBase, downloadCap: 10 }).success,
    ).toBe(false);
  });

  it("rejects invalid email in recipientEmails[]", () => {
    expect(
      CreateTransferSchema.safeParse({
        ...validBase,
        recipientEmails: ["not-an-email"],
      }).success,
    ).toBe(false);
  });

  it("accepts null or empty recipientEmails", () => {
    expect(
      CreateTransferSchema.safeParse({ ...validBase, recipientEmails: null })
        .success,
    ).toBe(true);
    expect(
      CreateTransferSchema.safeParse({ ...validBase, recipientEmails: [] })
        .success,
    ).toBe(true);
  });

  it("accepts up to MAX_RECIPIENTS recipient emails", () => {
    const emails = Array.from({ length: 10 }, (_, i) => `user${i}@example.com`);
    expect(
      CreateTransferSchema.safeParse({
        ...validBase,
        recipientEmails: emails,
      }).success,
    ).toBe(true);
  });

  it("rejects more than MAX_RECIPIENTS recipient emails", () => {
    const emails = Array.from({ length: 11 }, (_, i) => `user${i}@example.com`);
    expect(
      CreateTransferSchema.safeParse({
        ...validBase,
        recipientEmails: emails,
      }).success,
    ).toBe(false);
  });

  it("rejects sender message over MAX_MESSAGE_LEN", () => {
    expect(
      CreateTransferSchema.safeParse({
        ...validBase,
        senderMessage: "x".repeat(MAX_MESSAGE_LEN + 1),
      }).success,
    ).toBe(false);
  });

  it("requires full password bundle when password is provided", () => {
    const incomplete = CreateTransferSchema.safeParse({
      ...validBase,
      password: { salt: "s", wrappedKey: "k" } as unknown,
    });
    expect(incomplete.success).toBe(false);

    const complete = CreateTransferSchema.safeParse({
      ...validBase,
      password: {
        salt: "salt-b64u",
        wrappedKey: "wrapped-b64u",
        kdfParams: { alg: "argon2id", m: 65536, t: 3, p: 1 },
      },
    });
    expect(complete.success).toBe(true);
  });
});

describe("PartsRequestSchema", () => {
  it("accepts a valid batch", () => {
    expect(
      PartsRequestSchema.safeParse({
        fileIndex: 0,
        partNumbers: [1, 2, 3],
      }).success,
    ).toBe(true);
  });

  it("rejects empty partNumbers", () => {
    expect(
      PartsRequestSchema.safeParse({ fileIndex: 0, partNumbers: [] }).success,
    ).toBe(false);
  });

  it("rejects partNumber < 1", () => {
    expect(
      PartsRequestSchema.safeParse({
        fileIndex: 0,
        partNumbers: [0],
      }).success,
    ).toBe(false);
  });

  it("rejects partNumber > 10000 (S3 hard limit)", () => {
    expect(
      PartsRequestSchema.safeParse({
        fileIndex: 0,
        partNumbers: [10_001],
      }).success,
    ).toBe(false);
  });
});

describe("CompleteTransferSchema", () => {
  it("accepts a well-formed complete payload", () => {
    expect(
      CompleteTransferSchema.safeParse({
        shareUrl: "https://files.arthur-trt.fr/t/ABC#v1.key",
        files: [
          { fileIndex: 0 },
          {
            fileIndex: 1,
            parts: [{ partNumber: 1, eTag: "abc" }],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects missing shareUrl", () => {
    expect(
      CompleteTransferSchema.safeParse({ files: [{ fileIndex: 0 }] }).success,
    ).toBe(false);
  });
});

describe("NotifySchema", () => {
  it("rejects bogus emails and URLs", () => {
    expect(
      NotifySchema.safeParse({
        shareUrl: "not-a-url",
        recipientEmail: "also-not-an-email",
      }).success,
    ).toBe(false);
  });
});

describe("helpers", () => {
  it("ttlToExpires returns a future date within the right window", () => {
    const now = Date.now();
    const day = ttlToExpires("1d").getTime();
    expect(day).toBeGreaterThan(now);
    expect(day - now).toBeLessThanOrEqual(86_400_000 + 1000);
    expect(day - now).toBeGreaterThan(86_400_000 - 1000);
  });

  it("newTransferId has the expected shape", () => {
    const id = newTransferId();
    expect(id).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
  });

  it("newTransferId produces distinct IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(newTransferId());
    expect(ids.size).toBe(100);
  });
});
