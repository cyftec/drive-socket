export class DriveAmbiguousPathError extends Error {
  readonly parentFolderId: string;
  readonly folderName: string;

  constructor(parentFolderId: string, folderName: string) {
    super(
      `Multiple folders named "${folderName}" found under parent "${parentFolderId}"`,
    );
    this.name = "DriveAmbiguousPathError";
    this.parentFolderId = parentFolderId;
    this.folderName = folderName;
  }
}
