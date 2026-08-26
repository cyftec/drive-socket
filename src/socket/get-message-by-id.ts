import type { DriveClient } from '../drive/drive-client.ts';
import { downloadAppDataFile } from '../drive/download-app-data-file.ts';
import { toPushedMessage } from '../messages/parser/to-pushed-message.ts';
import type { DriveFileMetadata, PushedMessage } from '../types/index.ts';

export async function getMessageById<T>(
  client: DriveClient,
  fileId: string,
): Promise<PushedMessage<T>> {
  const response = await client.request(
    `/files/${fileId}?fields=id,name,createdTime,mimeType,size`,
  );
  const file = (await response.json()) as DriveFileMetadata;
  const body = await downloadAppDataFile(client, fileId);
  return toPushedMessage<T>(file, body);
}
