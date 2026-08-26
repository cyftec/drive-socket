import { toBlob } from '../blob/to-blob.ts';

export function encodeMultipart(
  metadata: Record<string, unknown>,
  content: Blob | ArrayBuffer | Uint8Array,
  mimeType: string,
): { body: Blob; boundary: string } {
  const boundary = `drive_socket_${crypto.randomUUID()}`;
  const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const filePartHeader = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;
  const contentBlob = toBlob(content, mimeType);

  const body = new Blob([metaPart, filePartHeader, contentBlob, closing], {
    type: `multipart/related; boundary=${boundary}`,
  });

  return { body, boundary };
}
