export function encodeMultipart(
  metadata: Record<string, unknown>,
  fileBlob: Blob,
  mimeType: string,
): Blob {
  const boundary = `drive_socket_${crypto.randomUUID()}`;
  const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const filePartHeader = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;

  return new Blob([metaPart, filePartHeader, fileBlob, closing], {
    type: `multipart/related; boundary=${boundary}`,
  });
}
