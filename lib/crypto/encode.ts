export function bytesToB64u(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uToBytes(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const FRAGMENT_VERSION = "v1";

export function encodeFragment(keyBytes: Uint8Array): string {
  return `${FRAGMENT_VERSION}.${bytesToB64u(keyBytes)}`;
}

export function decodeFragment(fragment: string): Uint8Array {
  const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const [version, b64u] = raw.split(".");
  if (version !== FRAGMENT_VERSION || !b64u) {
    throw new Error(`Unsupported fragment version: ${version || "none"}`);
  }
  const bytes = b64uToBytes(b64u);
  if (bytes.length !== 32) throw new Error("Invalid key length in fragment");
  return bytes;
}
