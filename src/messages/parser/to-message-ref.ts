import type { DriveFileMetadata, MessageRef } from '../../types/index.ts';

export function toMessageRef(file: DriveFileMetadata): MessageRef {
  return {
    fileId: file.id,
    fileName: file.name,
    createdTime: file.createdTime,
    mimeType: file.mimeType,
    size: file.size ? Number(file.size) : undefined,
  };
}
