export async function wrapKey(
  rawFileKey: Uint8Array,
  passwordDerivedKey: CryptoKey,
): Promise<Uint8Array> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    passwordDerivedKey,
    rawFileKey,
  );
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return out;
}

export async function unwrapKey(
  wrapped: Uint8Array,
  passwordDerivedKey: CryptoKey,
): Promise<Uint8Array> {
  if (wrapped.length < 12 + 32) throw new Error("wrapped key too short");
  const iv = wrapped.slice(0, 12);
  const ct = wrapped.slice(12);
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    passwordDerivedKey,
    ct,
  );
  return new Uint8Array(raw);
}

export async function importPasswordDerivedKey(
  raw: Uint8Array,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}
