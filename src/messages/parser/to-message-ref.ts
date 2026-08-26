import type { DriveFileMetadata, MessageKind, MessageRef } from '../../types/index.ts';

export function inferMessageKind(mimeType: string): MessageKind {
  return mimeType === 'application/json' ? 'json' : 'file';
}

export function toMessageRef(file: DriveFileMetadata): MessageRef {
  return {
    fileId: file.id,
    fileName: file.name,
    createdTime: file.createdTime,
    mimeType: file.mimeType,
    kind: inferMessageKind(file.mimeType),
    size: file.size ? Number(file.size) : undefined,
  };
}
