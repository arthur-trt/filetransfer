export type ManifestFile = {
  name: string;
  mime: string;
  size: number;
  chunks: number;
};

export type Manifest = {
  version: 1;
  message?: string;
  files: ManifestFile[];
};

const IV_BYTES = 12;

export async function encryptManifest(
  key: CryptoKey,
  manifest: Manifest,
): Promise<Uint8Array> {
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  const pt = new TextEncoder().encode(JSON.stringify(manifest));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

export async function decryptManifest(
  key: CryptoKey,
  blob: Uint8Array,
): Promise<Manifest> {
  if (blob.length < IV_BYTES + 16) throw new Error("manifest blob too short");
  const iv = blob.slice(0, IV_BYTES);
  const ct = blob.slice(IV_BYTES);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt)) as Manifest;
}
