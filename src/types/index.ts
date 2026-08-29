export interface DriveMessage {
  id: string;
  name: string;
  fileBlob: Blob;
  isError?: boolean;
}

export interface DriveSocketConfig {
  clientId: string;
  folderName: string;
  pollIntervalInMs: number;
  maxFiles: number;
}
