import { describe, it, expect } from "vitest";
import { deriveKey, randomSalt, DEFAULT_KDF } from "@/lib/crypto/argon";

// Argon2id is slow on purpose (OWASP interactive cost). Use a cheap param set
// for CI so the suite stays <10s total.
const TEST_KDF = { alg: "argon2id" as const, m: 1024, t: 1, p: 1 };

describe("Argon2id KDF", () => {
  it("produces 32-byte output", async () => {
    const salt = randomSalt();
    const out = await deriveKey("hunter2", salt, TEST_KDF);
    expect(out.length).toBe(32);
  });

  it("is deterministic for same input", async () => {
    const salt = randomSalt();
    const a = await deriveKey("same password", salt, TEST_KDF);
    const b = await deriveKey("same password", salt, TEST_KDF);
    expect(a).toEqual(b);
  });

  it("differs with different salts", async () => {
    const a = await deriveKey("same password", randomSalt(), TEST_KDF);
    const b = await deriveKey("same password", randomSalt(), TEST_KDF);
    expect(a).not.toEqual(b);
  });

  it("differs with different passwords", async () => {
    const salt = randomSalt();
    const a = await deriveKey("pw a", salt, TEST_KDF);
    const b = await deriveKey("pw b", salt, TEST_KDF);
    expect(a).not.toEqual(b);
  });

  it("rejects non-argon2id algorithms", async () => {
    const salt = randomSalt();
    await expect(
      deriveKey("pw", salt, { ...TEST_KDF, alg: "scrypt" as unknown as "argon2id" }),
    ).rejects.toThrow(/Unsupported/);
  });

  it("DEFAULT_KDF has reasonable OWASP parameters", () => {
    // Sanity: keep our production params from drifting below OWASP floor.
    expect(DEFAULT_KDF.alg).toBe("argon2id");
    expect(DEFAULT_KDF.m).toBeGreaterThanOrEqual(64 * 1024);
    expect(DEFAULT_KDF.t).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_KDF.p).toBeGreaterThanOrEqual(1);
  });
});
