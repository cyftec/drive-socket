import type { DriveClient } from '../drive/drive-client.ts';
import { appDataFileExists } from '../drive/app-data-file-exists.ts';
import { createAppDataFile } from '../drive/create-app-data-file.ts';
import { generateMessageFileName } from '../messages/filename/generate-message-file-name.ts';
import { mimeToExtension } from '../messages/mime/mime-to-extension.ts';
import { toPushedMessage } from '../messages/parser/to-pushed-message.ts';
import { MessageExistsError } from '../errors/message-exists-error.ts';
import type { PushedMessageJson } from '../types/index.ts';

export async function pushJson<T>(
  client: DriveClient,
  payload: T,
): Promise<PushedMessageJson<T>> {
  const fileName = generateMessageFileName('json');
  if (await appDataFileExists(client, fileName)) throw new MessageExistsError(fileName);
  const content = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const file = await createAppDataFile(client, fileName, 'application/json', content);
  const message = await toPushedMessage<T>(file, content);
  if (message.kind !== 'json') throw new Error('Expected JSON message');
  return message;
}
