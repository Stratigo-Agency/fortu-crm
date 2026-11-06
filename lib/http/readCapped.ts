/** The request body as bytes, or null when it is larger than `max` bytes (checked before and while reading). */
export async function readCappedBytes(request: Request, max: number): Promise<Buffer | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** The request body as text, or null when it is larger than `max` bytes. */
export async function readCapped(request: Request, max: number): Promise<string | null> {
  const bytes = await readCappedBytes(request, max);
  return bytes === null ? null : bytes.toString("utf8");
}
