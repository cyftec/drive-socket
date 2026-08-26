import type { DriveClient } from './drive-client.ts';
import type { DriveFileMetadata } from '../types/index.ts';
import { encodeMultipart } from '../messages/multipart/encode-multipart.ts';

export async function createAppDataFile(
  client: DriveClient,
  fileName: string,
  mimeType: string,
  content: Blob | ArrayBuffer | Uint8Array,
): Promise<DriveFileMetadata> {
  const metadata = { name: fileName, parents: ['appDataFolder'], mimeType };
  const { body } = encodeMultipart(metadata, content, mimeType);
  const response = await client.request(
    '/files?uploadType=multipart&fields=id,name,createdTime,mimeType,size',
    { method: 'POST', body },
    client.uploadBase,
  );
  return (await response.json()) as DriveFileMetadata;
}
