export function toBlob(
  content: Blob | ArrayBuffer | Uint8Array,
  mimeType: string,
): Blob {
  if (content instanceof Blob) return content;
  const part: BlobPart = content instanceof ArrayBuffer ? content : new Uint8Array(content);
  return new Blob([part], { type: mimeType });
}
