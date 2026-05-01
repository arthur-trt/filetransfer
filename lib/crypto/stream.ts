export const CHUNK_PLAINTEXT_SIZE = 5 * 1024 * 1024;
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const LEN_PREFIX_BYTES = 4;
const PER_CHUNK_OVERHEAD = LEN_PREFIX_BYTES + IV_BYTES + GCM_TAG_BYTES;

export function expectedCiphertextSize(plaintextBytes: number): number {
  if (plaintextBytes === 0) return PER_CHUNK_OVERHEAD;
  const chunks = Math.ceil(plaintextBytes / CHUNK_PLAINTEXT_SIZE);
  return plaintextBytes + chunks * PER_CHUNK_OVERHEAD;
}

export function chunkCount(plaintextBytes: number): number {
  if (plaintextBytes === 0) return 1;
  return Math.ceil(plaintextBytes / CHUNK_PLAINTEXT_SIZE);
}

function writeUint32BE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, false);
}

async function encryptChunk(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );
  const frame = new Uint8Array(LEN_PREFIX_BYTES + IV_BYTES + ct.length);
  const view = new DataView(frame.buffer);
  writeUint32BE(view, 0, IV_BYTES + ct.length);
  frame.set(iv, LEN_PREFIX_BYTES);
  frame.set(ct, LEN_PREFIX_BYTES + IV_BYTES);
  return frame;
}

async function decryptChunk(
  key: CryptoKey,
  iv: Uint8Array,
  ct: Uint8Array,
): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new Uint8Array(pt);
}

export function encryptStream(
  key: CryptoKey,
  input: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const reader = input.getReader();
  let buffer = new Uint8Array(0);
  let sourceDone = false;
  let emittedAny = false;

  async function fillBuffer(target: number): Promise<void> {
    while (buffer.length < target && !sourceDone) {
      const { value, done } = await reader.read();
      if (done) {
        sourceDone = true;
        return;
      }
      if (value && value.length) {
        const merged = new Uint8Array(buffer.length + value.length);
        merged.set(buffer, 0);
        merged.set(value, buffer.length);
        buffer = merged;
      }
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        await fillBuffer(CHUNK_PLAINTEXT_SIZE);
        if (buffer.length === 0) {
          if (sourceDone && !emittedAny) {
            const frame = await encryptChunk(key, new Uint8Array(0));
            controller.enqueue(frame);
            emittedAny = true;
          }
          controller.close();
          return;
        }
        const take = Math.min(buffer.length, CHUNK_PLAINTEXT_SIZE);
        const chunk = buffer.slice(0, take);
        buffer = buffer.slice(take);
        const frame = await encryptChunk(key, chunk);
        controller.enqueue(frame);
        emittedAny = true;
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {});
    },
  });
}

export function decryptStream(
  key: CryptoKey,
  input: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const reader = input.getReader();
  let buffer = new Uint8Array(0);
  let sourceDone = false;

  async function need(target: number): Promise<boolean> {
    while (buffer.length < target && !sourceDone) {
      const { value, done } = await reader.read();
      if (done) {
        sourceDone = true;
        break;
      }
      if (value && value.length) {
        const merged = new Uint8Array(buffer.length + value.length);
        merged.set(buffer, 0);
        merged.set(value, buffer.length);
        buffer = merged;
      }
    }
    return buffer.length >= target;
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          if (!(await need(LEN_PREFIX_BYTES))) {
            controller.close();
            return;
          }
          const view = new DataView(
            buffer.buffer,
            buffer.byteOffset,
            LEN_PREFIX_BYTES,
          );
          const frameLen = view.getUint32(0, false);
          if (!(await need(LEN_PREFIX_BYTES + frameLen))) {
            throw new Error("truncated ciphertext stream");
          }
          const iv = buffer.slice(
            LEN_PREFIX_BYTES,
            LEN_PREFIX_BYTES + IV_BYTES,
          );
          const ct = buffer.slice(
            LEN_PREFIX_BYTES + IV_BYTES,
            LEN_PREFIX_BYTES + frameLen,
          );
          buffer = buffer.slice(LEN_PREFIX_BYTES + frameLen);
          const pt = await decryptChunk(key, iv, ct);
          if (pt.length > 0) {
            controller.enqueue(pt);
            return;
          }
          // Empty frame (legitimately encrypted empty input or a marker) —
          // keep pulling; don't leave the stream deadlocked with no work.
        }
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {});
    },
  });
}
