import type {
  DriveFileMetadata,
  FileMetadataField,
} from "../google";

export type FileMetadata<F extends FileMetadataField> = DriveFileMetadata<F>;

export type FileMessage<F extends FileMetadataField> = FileMetadata<F> & {
  fileBlob: Blob;
};

export interface DriveSocketConfig<F extends FileMetadataField = never> {
  clientId: string;
  folderName: string;
  pollIntervalInMs: number;
  maxFiles: number;
  metadataFields?: readonly F[];
}

export type OnReceiveEvent<F extends FileMetadataField> =
  | { type: "metadata"; files: FileMetadata<F>[] }
  | { type: "file"; message: FileMessage<F> };
