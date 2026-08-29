export interface DriveMessage {
  id: string;
  name: string;
  fileBlob: Blob;
}

export interface DriveSocketConfig {
  clientId: string;
  folderName: string;
  pollIntervalInMs: number;
  maxFiles: number;
}
