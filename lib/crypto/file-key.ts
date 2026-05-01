export async function generateFileKey(): Promise<{
  key: CryptoKey;
  raw: Uint8Array;
}> {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const key = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return { key, raw };
}

export async function importFileKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error("file key must be 32 bytes");
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}
