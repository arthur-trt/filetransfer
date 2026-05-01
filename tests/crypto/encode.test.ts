import { describe, it, expect } from "vitest";
import {
  bytesToB64u,
  b64uToBytes,
  encodeFragment,
  decodeFragment,
  FRAGMENT_VERSION,
} from "@/lib/crypto/encode";

describe("base64url round-trip", () => {
  it("round-trips arbitrary bytes", () => {
    const rng = new Uint8Array(256);
    for (let i = 0; i < rng.length; i++) rng[i] = i;
    const encoded = bytesToB64u(rng);
    const decoded = b64uToBytes(encoded);
    expect(decoded).toEqual(rng);
  });

  it("produces URL-safe output (no + / =)", () => {
    const bytes = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
    const encoded = bytesToB64u(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("handles empty input", () => {
    expect(bytesToB64u(new Uint8Array(0))).toBe("");
    expect(b64uToBytes("")).toEqual(new Uint8Array(0));
  });
});

describe("fragment encoding", () => {
  it("round-trips a 32-byte key", () => {
    const key = new Uint8Array(32);
    crypto.getRandomValues(key);
    const fragment = encodeFragment(key);
    expect(fragment.startsWith(`${FRAGMENT_VERSION}.`)).toBe(true);
    expect(decodeFragment(fragment)).toEqual(key);
  });

  it("accepts leading '#' in input", () => {
    const key = new Uint8Array(32);
    crypto.getRandomValues(key);
    const fragment = encodeFragment(key);
    expect(decodeFragment("#" + fragment)).toEqual(key);
  });

  it("rejects wrong version", () => {
    expect(() => decodeFragment("v2.AAAA")).toThrow(/version/);
  });

  it("rejects malformed fragment (no separator)", () => {
    expect(() => decodeFragment("garbage")).toThrow();
  });

  it("rejects key of wrong length", () => {
    const short = new Uint8Array(16);
    const fragment = encodeFragment(short);
    expect(() => decodeFragment(fragment)).toThrow(/length/);
  });
});
