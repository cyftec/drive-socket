export class MessageExistsError extends Error {
  readonly fileName: string;

  constructor(fileName: string) {
    super(`Message file already exists: ${fileName}`);
    this.name = 'MessageExistsError';
    this.fileName = fileName;
  }
}
