import { toBlob } from '../messages/blob/to-blob.ts';
import type { DriveClient } from '../drive/drive-client.ts';
import { appDataFileExists } from '../drive/app-data-file-exists.ts';
import { createAppDataFile } from '../drive/create-app-data-file.ts';
import { generateMessageFileName } from '../messages/filename/generate-message-file-name.ts';
import { isValidMimeType } from '../messages/mime/is-valid-mime-type.ts';
import { mimeToExtension } from '../messages/mime/mime-to-extension.ts';
import { toPushedMessage } from '../messages/parser/to-pushed-message.ts';
import { InvalidMimeError } from '../errors/invalid-mime-error.ts';
import { MessageExistsError } from '../errors/message-exists-error.ts';
import type { PushedMessageFile } from '../types/index.ts';

export async function pushFile(
  client: DriveClient,
  data: Blob | ArrayBuffer | Uint8Array,
  mimeType: string,
): Promise<PushedMessageFile> {
  if (mimeType === 'application/json') {
    throw new InvalidMimeError(mimeType, 'use pushJson() for JSON payloads');
  }
  if (!isValidMimeType(mimeType)) {
    throw new InvalidMimeError(mimeType, 'must match type/subtype format');
  }
  const extension = mimeToExtension(mimeType);
  const fileName = generateMessageFileName(extension);
  if (await appDataFileExists(client, fileName)) throw new MessageExistsError(fileName);
  const content = toBlob(data, mimeType);
  const file = await createAppDataFile(client, fileName, mimeType, content);
  const message = await toPushedMessage(file, content);
  if (message.kind !== 'file') throw new Error('Expected file message');
  return message;
}
