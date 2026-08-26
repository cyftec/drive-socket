export class InvalidMimeError extends Error {
  readonly mimeType: string;

  constructor(mimeType: string, reason: string) {
    super(`Invalid MIME type "${mimeType}": ${reason}`);
    this.name = 'InvalidMimeError';
    this.mimeType = mimeType;
  }
}
