import type { DriveClient } from '../drive/drive-client.ts';
import { listAppDataFiles } from '../drive/list-app-data-files.ts';
import { toMessageRef } from '../messages/parser/to-message-ref.ts';
import type { MessageRef } from '../types/index.ts';

export async function collectMessageRefs(
  client: DriveClient,
  query: string,
  orderBy?: string,
): Promise<MessageRef[]> {
  const refs: MessageRef[] = [];
  let pageToken: string | undefined;
  do {
    const result = await listAppDataFiles(client, query, { pageToken, orderBy });
    for (const file of result.files ?? []) refs.push(toMessageRef(file));
    pageToken = result.nextPageToken;
  } while (pageToken);
  return refs;
}
