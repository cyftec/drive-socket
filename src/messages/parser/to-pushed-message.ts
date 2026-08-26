import type { DriveFileMetadata, PushedMessage } from '../../types/index.ts';
import { toMessageRef } from './to-message-ref.ts';

export function toPushedMessage(file: DriveFileMetadata, body: Blob): PushedMessage {
  return { ...toMessageRef(file), payload: body };
}
