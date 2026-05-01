import { describe, it, expect } from "vitest";
import { encryptManifest, decryptManifest, type Manifest } from "@/lib/crypto/manifest";
import { generateFileKey } from "@/lib/crypto/file-key";

describe("manifest encryption", () => {
  it("round-trips a manifest", async () => {
    const { key } = await generateFileKey();
    const manifest: Manifest = {
      version: 1,
      message: "hello friend",
      files: [
        { name: "photo.jpg", mime: "image/jpeg", size: 1024, chunks: 1 },
        { name: "notes.pdf", mime: "application/pdf", size: 8_000_000, chunks: 2 },
      ],
    };
    const blob = await encryptManifest(key, manifest);
    const decoded = await decryptManifest(key, blob);
    expect(decoded).toEqual(manifest);
  });

  it("fails to decrypt with wrong key", async () => {
    const senderKey = await generateFileKey();
    const attackerKey = await generateFileKey();
    const manifest: Manifest = {
      version: 1,
      files: [{ name: "a", mime: "text/plain", size: 1, chunks: 1 }],
    };
    const blob = await encryptManifest(senderKey.key, manifest);
    await expect(decryptManifest(attackerKey.key, blob)).rejects.toThrow();
  });

  it("rejects blob that's too short", async () => {
    const { key } = await generateFileKey();
    await expect(decryptManifest(key, new Uint8Array(10))).rejects.toThrow(
      /too short/,
    );
  });

  it("preserves unicode filenames and messages", async () => {
    const { key } = await generateFileKey();
    const manifest: Manifest = {
      version: 1,
      message: "こんにちは 🎉",
      files: [{ name: "é•∆∫.txt", mime: "text/plain", size: 3, chunks: 1 }],
    };
    const blob = await encryptManifest(key, manifest);
    const decoded = await decryptManifest(key, blob);
    expect(decoded).toEqual(manifest);
  });
});
