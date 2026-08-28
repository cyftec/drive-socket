export class FilenameExtensionMismatchError extends Error {
  readonly fileName: string;
  readonly mimeType: string;
  readonly expectedExtension: string;

  constructor(fileName: string, mimeType: string, expectedExtension: string) {
    super(
      `Filename "${fileName}" extension does not match MIME type "${mimeType}" (expected ".${expectedExtension}")`,
    );
    this.name = "FilenameExtensionMismatchError";
    this.fileName = fileName;
    this.mimeType = mimeType;
    this.expectedExtension = expectedExtension;
  }
}
