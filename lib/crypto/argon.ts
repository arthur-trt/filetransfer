import { argon2id } from "hash-wasm";

export type KdfParams = {
  alg: "argon2id";
  m: number; // memory in KiB
  t: number; // iterations
  p: number; // parallelism
};

export const DEFAULT_KDF: KdfParams = {
  alg: "argon2id",
  m: 64 * 1024,
  t: 3,
  p: 1,
};

export async function deriveKey(
  password: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF,
  onProgress?: (pct: number) => void,
): Promise<Uint8Array> {
  if (params.alg !== "argon2id") {
    throw new Error(`Unsupported KDF: ${params.alg}`);
  }
  const hex = await argon2id({
    password,
    salt,
    parallelism: params.p,
    iterations: params.t,
    memorySize: params.m,
    hashLength: 32,
    outputType: "hex",
    ...(onProgress ? { onProgress: (p: number) => onProgress(p) } : {}),
  });
  return hexToBytes(hex);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

export function randomSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}
