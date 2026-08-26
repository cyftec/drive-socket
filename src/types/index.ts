export interface FileMessageMetadata {
  id: string;
  name: string;
  createdTime: string;
  mimeType: string;
  size?: string;
}

export interface FileMessage extends FileMessageMetadata {
  fileBlob: Blob;
}

export interface DriveSocketConfig {
  clientId: string;
}

export type ReceiveAs = "file-message-metadata" | "file-message";

export interface ReceiveOptions {
  as: ReceiveAs;
  since?: Date;
  until?: Date;
  limit?: number;
}

export interface PruneOptions {
  dryRun?: boolean;
}

export interface PruneResult {
  deleted: FileMessageMetadata[];
  deletedCount: number;
  keptCount: number;
}
