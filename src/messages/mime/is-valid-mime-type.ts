const MIME_PATTERN = /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/;

export function isValidMimeType(mimeType: string): boolean {
  return MIME_PATTERN.test(mimeType);
}
