export interface MessageRef {
  fileId: string;
  fileName: string;
  createdTime: string;
  mimeType: string;
  size?: number;
}

export interface PushedMessage extends MessageRef {
  payload: Blob;
}

export interface DriveSocketConfig {
  clientId: string;
}

export type ReceiveAs = "metadata" | "payload";

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
  deleted: MessageRef[];
  deletedCount: number;
  keptCount: number;
}

export interface DriveFileMetadata {
  id: string;
  name: string;
  createdTime: string;
  mimeType: string;
  size?: string;
}
