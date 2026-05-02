import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resumableFetch } from "@/lib/resume-fetch";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

function bytes(size: number, fill = 0): Uint8Array {
  const b = new Uint8Array(size);
  b.fill(fill);
  return b;
}

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

function brokenStreamAfter(
  emitted: Uint8Array,
  error: Error,
): ReadableStream<Uint8Array> {
  // Delivers `emitted` on the first pull, errors on the second.
  // Can't enqueue + error synchronously: controller.error() resets the queue,
  // so the chunk would never be read.
  let phase: "pending" | "delivered" = "pending";
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (phase === "pending") {
        controller.enqueue(emitted);
        phase = "delivered";
      } else {
        controller.error(error);
      }
    },
  });
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const out: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) out.push(value);
  }
  const total = out.reduce((n, c) => n + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of out) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

function parseRange(init?: RequestInit): number {
  const rangeHeader =
    init?.headers && (init.headers as Record<string, string>)["Range"];
  if (!rangeHeader) return 0;
  const m = /^bytes=(\d+)-/.exec(rangeHeader);
  return m ? Number(m[1]) : 0;
}

describe("resumableFetch", () => {
  it("passes through a healthy stream without retries", async () => {
    const payload = bytes(1024, 0xab);
    const onRetry = vi.fn();
    globalThis.fetch = vi.fn(async () =>
      new Response(streamOf(payload), { status: 200 }),
    ) as unknown as typeof fetch;

    const stream = resumableFetch({
      urlProvider: async () => "https://example.test/obj",
      onRetry,
    });
    const received = await drain(stream);
    expect(received).toEqual(payload);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("resumes from last received byte after a mid-stream error", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const full = bytes(100, 0x00);
    for (let i = 0; i < full.length; i++) full[i] = i & 0xff;

    const calls: number[] = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      const start = parseRange(init as RequestInit);
      calls.push(start);
      if (calls.length === 1) {
        // First call: emit first 40 bytes then fail.
        return new Response(
          brokenStreamAfter(
            full.slice(0, 40),
            new TypeError("network error"),
          ),
          { status: 200 },
        );
      }
      // Retry: honor Range, emit the rest.
      return new Response(streamOf(full.slice(start)), { status: 206 });
    }) as unknown as typeof fetch;

    const stream = resumableFetch({
      urlProvider: async () => "https://example.test/obj",
    });
    const received = await drain(stream);
    expect(received).toEqual(full);
    expect(calls).toEqual([0, 40]);
  });

  it("retries up to maxAttempts, then gives up", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const attempts: number[] = [];
    globalThis.fetch = vi.fn(async () => {
      attempts.push(1);
      throw new TypeError("network");
    }) as unknown as typeof fetch;

    const stream = resumableFetch({
      urlProvider: async () => "https://example.test/obj",
      maxAttempts: 3,
    });
    await expect(drain(stream)).rejects.toBeDefined();
    expect(attempts.length).toBe(3);
  });

  it("does not retry 4xx other than 416", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("no", { status: 404 }),
    ) as unknown as typeof fetch;

    const stream = resumableFetch({
      urlProvider: async () => "https://example.test/obj",
    });
    await expect(drain(stream)).rejects.toThrow(/HTTP 404/);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("fails hard if server ignores Range on resume (can't undo already-delivered bytes)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const full = bytes(80, 0);
    for (let i = 0; i < full.length; i++) full[i] = i & 0xff;

    globalThis.fetch = vi.fn(async (_url, init) => {
      const start = parseRange(init as RequestInit);
      if (start === 0) {
        return new Response(
          brokenStreamAfter(full.slice(0, 30), new TypeError("net")),
          { status: 200 },
        );
      }
      // Retry asked for bytes=30- but server ignores Range and sends full body.
      // We can't silently restart (30 bytes already downstream) — must error.
      return new Response(streamOf(full), { status: 200 });
    }) as unknown as typeof fetch;

    const stream = resumableFetch({
      urlProvider: async () => "https://example.test/obj",
    });
    await expect(drain(stream)).rejects.toThrow(/ignored Range/);
  });

  it("propagates AbortError without retrying", async () => {
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = vi.fn(async () =>
      new Response(streamOf(bytes(10))),
    ) as unknown as typeof fetch;

    const stream = resumableFetch({
      urlProvider: async () => "https://example.test/obj",
      signal: controller.signal,
    });
    await expect(drain(stream)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("calls onRetry with monotonically increasing attempt and byte count", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const full = bytes(90);
    for (let i = 0; i < full.length; i++) full[i] = i;

    let callCount = 0;
    globalThis.fetch = vi.fn(async (_url, init) => {
      callCount++;
      const start = parseRange(init as RequestInit);
      if (callCount < 3) {
        return new Response(
          brokenStreamAfter(full.slice(start, start + 30), new TypeError("net")),
          { status: callCount === 1 ? 200 : 206 },
        );
      }
      return new Response(streamOf(full.slice(start)), { status: 206 });
    }) as unknown as typeof fetch;

    const onRetry = vi.fn();
    const stream = resumableFetch({
      urlProvider: async () => "https://example.test/obj",
      onRetry,
    });
    const received = await drain(stream);
    expect(received).toEqual(full);
    expect(onRetry).toHaveBeenCalledTimes(2);
    const calls = onRetry.mock.calls.map((c) => c[0]);
    expect(calls[0].attempt).toBe(1);
    expect(calls[0].bytesReceived).toBe(30);
    expect(calls[1].attempt).toBe(2);
    expect(calls[1].bytesReceived).toBe(60);
  });
});
