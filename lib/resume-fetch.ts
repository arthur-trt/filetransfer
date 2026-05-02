// Retrying HTTP fetch that emits a ReadableStream<Uint8Array> and resumes
// from the last received byte offset via `Range:` when the transport fails
// mid-stream. Used to survive network blips on multi-GB downloads without
// losing progress or burning the server-side download counter.
//
// Semantics:
// - The urlProvider returns a (possibly fresh) URL each call. Wrap it to
//   re-mint presigned URLs that have expired.
// - onRetry fires when we're about to sleep + retry. UI uses it to show
//   "Reconnecting…".
// - Terminal 4xx responses (404, 410, 403) are not retried.
// - The returned stream propagates a non-retryable failure as an error.

const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_INITIAL_BACKOFF_MS = 500;
const DEFAULT_MAX_BACKOFF_MS = 16_000;

export type ResumableFetchOptions = {
  urlProvider: () => Promise<string>;
  signal?: AbortSignal;
  onRetry?: (info: {
    attempt: number;
    bytesReceived: number;
    delayMs: number;
    error: unknown;
  }) => void;
  maxAttempts?: number;
};

export function resumableFetch(
  opts: ResumableFetchOptions,
): ReadableStream<Uint8Array> {
  const {
    urlProvider,
    signal,
    onRetry,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  } = opts;

  let bytesReceived = 0;
  let attempt = 0;
  let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const openStream = async (): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
    while (true) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      const url = await urlProvider();
      try {
        const headers: HeadersInit =
          bytesReceived > 0 ? { Range: `bytes=${bytesReceived}-` } : {};
        const resp = await fetch(url, { headers, signal });
        if (resp.status === 200 && bytesReceived > 0) {
          // Server ignored Range and returned the full body. We can't
          // "un-deliver" bytes already piped downstream — silently
          // discarding and restarting would double-write them. This is
          // a terminal failure; surface it instead of corrupting output.
          throw new TerminalHttpError(
            200,
            "server ignored Range on resume — cannot recover",
          );
        }
        if (resp.status === 206 || resp.status === 200) {
          if (!resp.body) throw new Error("response has no body");
          return resp.body.getReader();
        }
        if (resp.status === 416) {
          // "Range not satisfiable" — either the server doesn't support
          // Range or we've asked past end. If we've already received
          // something, treat as EOF; otherwise fatal.
          if (bytesReceived > 0) {
            throw new EndOfStreamSignal();
          }
          throw new TerminalHttpError(resp.status, resp.statusText);
        }
        // 4xx other than 416 is terminal.
        if (resp.status >= 400 && resp.status < 500) {
          throw new TerminalHttpError(resp.status, resp.statusText);
        }
        // 5xx → retry below.
        throw new Error(`HTTP ${resp.status}`);
      } catch (err) {
        if (err instanceof EndOfStreamSignal) throw err;
        if (err instanceof TerminalHttpError) throw err;
        if ((err as DOMException)?.name === "AbortError") throw err;
        attempt += 1;
        if (attempt >= maxAttempts) throw err;
        const delayMs = Math.min(
          DEFAULT_INITIAL_BACKOFF_MS * 2 ** (attempt - 1),
          DEFAULT_MAX_BACKOFF_MS,
        );
        onRetry?.({ attempt, bytesReceived, delayMs, error: err });
        await sleep(delayMs, signal);
      }
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!currentReader) {
          try {
            currentReader = await openStream();
          } catch (err) {
            if (err instanceof EndOfStreamSignal) {
              controller.close();
              return;
            }
            throw err;
          }
        }
        while (true) {
          try {
            const { value, done } = await currentReader.read();
            if (done) {
              controller.close();
              return;
            }
            if (value && value.length) {
              bytesReceived += value.length;
              controller.enqueue(value);
              return;
            }
          } catch (err) {
            // Mid-stream read error: treat as retryable.
            if ((err as DOMException)?.name === "AbortError") throw err;
            currentReader.cancel().catch(() => {});
            currentReader = null;
            attempt += 1;
            if (attempt >= maxAttempts) throw err;
            const delayMs = Math.min(
              DEFAULT_INITIAL_BACKOFF_MS * 2 ** (attempt - 1),
              DEFAULT_MAX_BACKOFF_MS,
            );
            onRetry?.({ attempt, bytesReceived, delayMs, error: err });
            await sleep(delayMs, signal);
            currentReader = await openStream();
          }
        }
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      currentReader?.cancel(reason).catch(() => {});
    },
  });
}

class TerminalHttpError extends Error {
  readonly status: number;
  constructor(status: number, statusText: string) {
    super(`HTTP ${status} ${statusText}`);
    this.name = "TerminalHttpError";
    this.status = status;
  }
}

class EndOfStreamSignal extends Error {
  constructor() {
    super("end of stream");
    this.name = "EndOfStreamSignal";
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
