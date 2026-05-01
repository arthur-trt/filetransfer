export const BLOB_FALLBACK_MAX_BYTES = 500 * 1024 * 1024;

// Sentinel thrown by saveStream when the browser advertises
// showSaveFilePicker but blocks createWritable (Samsung Internet, some
// embedded webviews, insecure contexts). The caller catches this and
// retries with saveBlobFromStream.
export class StreamingUnsupportedError extends Error {
  constructor(cause?: unknown) {
    super("Streaming download not permitted in this browser context");
    this.name = "StreamingUnsupportedError";
    if (cause) (this as { cause?: unknown }).cause = cause;
  }
}

export function hasFileSystemAccess(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { showSaveFilePicker?: unknown })
      .showSaveFilePicker === "function"
  );
}

type ShowSaveFilePicker = (opts?: {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

function progressTransform(
  onBytes: (n: number) => void,
): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream({
    transform(chunk, controller) {
      onBytes(chunk.byteLength);
      controller.enqueue(chunk);
    },
  });
}

export async function saveStream(
  stream: ReadableStream<Uint8Array>,
  suggestedName: string,
  onBytes?: (n: number) => void,
): Promise<void> {
  const picker = (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker })
    .showSaveFilePicker;
  if (!picker) throw new Error("File System Access API not supported");

  let handle: FileSystemFileHandle;
  try {
    handle = await picker({ suggestedName });
  } catch (err) {
    const e = err as DOMException;
    if (e?.name === "AbortError") return;
    // Some browsers (Samsung Internet, certain embedded webviews) throw
    // NotAllowedError on the picker itself. Treat as "fall back to blob".
    if (e?.name === "NotAllowedError" || e?.name === "SecurityError") {
      throw new StreamingUnsupportedError(err);
    }
    throw err;
  }

  let writable: FileSystemWritableFileStream;
  try {
    writable = await handle.createWritable();
  } catch (err) {
    const e = err as DOMException;
    // Samsung Internet exposes the picker but blocks createWritable() with
    // NotAllowedError. Signal the caller to fall back.
    if (e?.name === "NotAllowedError" || e?.name === "SecurityError") {
      throw new StreamingUnsupportedError(err);
    }
    throw err;
  }

  const piped = onBytes
    ? stream.pipeThrough(progressTransform(onBytes))
    : stream;
  try {
    await piped.pipeTo(writable);
  } catch (err) {
    await writable.abort(err instanceof Error ? err.message : "aborted").catch(
      () => {},
    );
    throw err;
  }
}

export async function saveBlobFromStream(
  stream: ReadableStream<Uint8Array>,
  filename: string,
  onBytes?: (n: number) => void,
): Promise<void> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value && value.length) {
      chunks.push(value);
      onBytes?.(value.byteLength);
    }
  }
  const blob = new Blob(chunks as BlobPart[]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
