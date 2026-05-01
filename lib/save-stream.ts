export const BLOB_FALLBACK_MAX_BYTES = 500 * 1024 * 1024;

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
    throw err;
  }
  const writable = await handle.createWritable();
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
