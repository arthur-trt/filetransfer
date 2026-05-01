import { describe, it, expect } from "vitest";
import {
  encryptStream,
  decryptStream,
  CHUNK_PLAINTEXT_SIZE,
  chunkCount,
  expectedCiphertextSize,
} from "@/lib/crypto/stream";
import { generateFileKey } from "@/lib/crypto/file-key";

function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function randomBytes(n: number): Uint8Array {
  // crypto.getRandomValues caps at 65 536 bytes per call.
  const out = new Uint8Array(n);
  const CAP = 65_536;
  for (let offset = 0; offset < n; offset += CAP) {
    crypto.getRandomValues(out.subarray(offset, Math.min(offset + CAP, n)));
  }
  return out;
}

async function drainToBytes(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

describe("encrypt/decrypt round-trip", () => {
  it("round-trips a small buffer (single chunk)", async () => {
    const { key } = await generateFileKey();
    const plaintext = new TextEncoder().encode("hello world");
    const ct = await drainToBytes(encryptStream(key, streamFromBytes(plaintext)));
    expect(ct.length).toBeGreaterThan(plaintext.length);
    const pt = await drainToBytes(decryptStream(key, streamFromBytes(ct)));
    expect(pt).toEqual(plaintext);
  });

  it("round-trips a multi-chunk buffer", async () => {
    const { key } = await generateFileKey();
    // Keep just past the chunk boundary so we exercise the multi-chunk path
    // without allocating tens of MB in CI.
    const size = CHUNK_PLAINTEXT_SIZE + 1024;
    const plaintext = randomBytes(size);
    const ct = await drainToBytes(encryptStream(key, streamFromBytes(plaintext)));
    const pt = await drainToBytes(decryptStream(key, streamFromBytes(ct)));
    expect(pt).toEqual(plaintext);
  });

  it("round-trips an empty buffer", async () => {
    const { key } = await generateFileKey();
    const plaintext = new Uint8Array(0);
    const ct = await drainToBytes(encryptStream(key, streamFromBytes(plaintext)));
    const pt = await drainToBytes(decryptStream(key, streamFromBytes(ct)));
    expect(pt).toEqual(plaintext);
  });

  it("rejects tampered ciphertext (single-byte flip)", async () => {
    const { key } = await generateFileKey();
    const plaintext = new TextEncoder().encode("tamper me");
    const ct = await drainToBytes(encryptStream(key, streamFromBytes(plaintext)));
    // Flip a byte inside the ciphertext payload (skip length prefix + iv).
    const tampered = ct.slice();
    tampered[20] ^= 0xff;
    await expect(
      drainToBytes(decryptStream(key, streamFromBytes(tampered))),
    ).rejects.toThrow();
  });

  it("rejects decryption with the wrong key", async () => {
    const senderKey = await generateFileKey();
    const attackerKey = await generateFileKey();
    const plaintext = new TextEncoder().encode("secret");
    const ct = await drainToBytes(
      encryptStream(senderKey.key, streamFromBytes(plaintext)),
    );
    await expect(
      drainToBytes(decryptStream(attackerKey.key, streamFromBytes(ct))),
    ).rejects.toThrow();
  });
});

describe("stream math helpers", () => {
  it("chunkCount matches boundary cases", () => {
    expect(chunkCount(0)).toBe(1);
    expect(chunkCount(1)).toBe(1);
    expect(chunkCount(CHUNK_PLAINTEXT_SIZE)).toBe(1);
    expect(chunkCount(CHUNK_PLAINTEXT_SIZE + 1)).toBe(2);
  });

  it("expectedCiphertextSize is monotonic and above plaintext", () => {
    const samples = [0, 1, 1024, CHUNK_PLAINTEXT_SIZE, CHUNK_PLAINTEXT_SIZE * 5 + 7];
    for (const n of samples) {
      expect(expectedCiphertextSize(n)).toBeGreaterThan(n);
    }
  });
});
