// Retry wrapper for idempotent-ish control-plane JSON POSTs. Transient
// failures (network errors, 5xx, 503) back off and retry; 4xx is terminal.
// Used by the upload orchestrator so a pod rollout mid-upload doesn't kill
// the whole transfer — only the sub-second API hop needs to survive.

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_INITIAL_BACKOFF_MS = 300;
const DEFAULT_MAX_BACKOFF_MS = 8_000;

export type RetryFetchOptions = {
  signal?: AbortSignal;
  maxAttempts?: number;
  onRetry?: (info: {
    attempt: number;
    delayMs: number;
    error: unknown;
  }) => void;
};

export async function retryFetchJson<T>(
  url: string,
  init: RequestInit,
  opts: RetryFetchOptions = {},
): Promise<T> {
  const {
    signal,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    onRetry,
  } = opts;
  const combinedSignal = signal ?? init.signal ?? undefined;

  let attempt = 0;
  while (true) {
    if (combinedSignal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    try {
      const resp = await fetch(url, { ...init, signal: combinedSignal });
      if (resp.ok) {
        return (await resp.json()) as T;
      }
      // 4xx is terminal — don't retry bad requests, auth failures, missing transfers.
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 408) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      // 5xx, 408 → retry
      throw new Error(`HTTP ${resp.status}`);
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") throw err;
      if (
        err instanceof Error &&
        /^HTTP 4\d\d/.test(err.message) &&
        !err.message.startsWith("HTTP 408")
      ) {
        throw err;
      }
      attempt += 1;
      if (attempt >= maxAttempts) throw err;
      const delayMs = Math.min(
        DEFAULT_INITIAL_BACKOFF_MS * 2 ** (attempt - 1),
        DEFAULT_MAX_BACKOFF_MS,
      );
      onRetry?.({ attempt, delayMs, error: err });
      await sleep(delayMs, combinedSignal);
    }
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
