import type {
  TimedFileQuery,
  DriveFileMetadata,
  FileMetadataField,
} from "../google";

export type FileMetadata<F extends FileMetadataField> = DriveFileMetadata<F>;

export type FileMessage<F extends FileMetadataField> = FileMetadata<F> & {
  fileBlob: Blob;
};

export interface DriveSocketConfig {
  clientId: string;
}

export type ReceiveAs = "file-message-metadata" | "file-message";

export interface ReceiveOptions {
  as: ReceiveAs;
  timeQuery?: TimedFileQuery;
  limit?: number;
}

export interface PruneOptions {
  dryRun?: boolean;
}

export interface PruneResult<F extends FileMetadataField> {
  deleted: FileMetadata<F>[];
  deletedCount: number;
  keptCount: number;
}
