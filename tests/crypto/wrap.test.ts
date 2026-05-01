import { describe, it, expect } from "vitest";
import { wrapKey, unwrapKey, importPasswordDerivedKey } from "@/lib/crypto/wrap";

async function randomKey(): Promise<CryptoKey> {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  return importPasswordDerivedKey(raw);
}

describe("key wrap/unwrap", () => {
  it("round-trips a 32-byte file key", async () => {
    const wrappingKey = await randomKey();
    const fileKey = new Uint8Array(32);
    crypto.getRandomValues(fileKey);
    const wrapped = await wrapKey(fileKey, wrappingKey);
    expect(wrapped.length).toBe(12 + 32 + 16);
    const unwrapped = await unwrapKey(wrapped, wrappingKey);
    expect(unwrapped).toEqual(fileKey);
  });

  it("fails to unwrap with a different key", async () => {
    const correct = await randomKey();
    const attacker = await randomKey();
    const fileKey = new Uint8Array(32);
    crypto.getRandomValues(fileKey);
    const wrapped = await wrapKey(fileKey, correct);
    await expect(unwrapKey(wrapped, attacker)).rejects.toThrow();
  });

  it("fails on tampered wrapped key", async () => {
    const wrappingKey = await randomKey();
    const fileKey = new Uint8Array(32);
    crypto.getRandomValues(fileKey);
    const wrapped = await wrapKey(fileKey, wrappingKey);
    const tampered = wrapped.slice();
    tampered[20] ^= 0xff;
    await expect(unwrapKey(tampered, wrappingKey)).rejects.toThrow();
  });

  it("rejects obviously-too-short wrapped blobs", async () => {
    const wrappingKey = await randomKey();
    await expect(unwrapKey(new Uint8Array(10), wrappingKey)).rejects.toThrow(
      /too short/,
    );
  });
});
