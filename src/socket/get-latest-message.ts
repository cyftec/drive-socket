import type { DriveClient } from "../drive/drive-client.ts";
import { downloadAppDataFile } from "../drive/download-app-data-file.ts";
import { listAppDataFiles } from "../drive/list-app-data-files.ts";
import { baseMessageQuery } from "../messages/query/base-message-query.ts";
import { toPushedMessage } from "../messages/parser/to-pushed-message.ts";
import type { PushedMessage } from '../types/index.ts';

export async function getLatestMessage<T>(
  client: DriveClient,
): Promise<PushedMessage<T> | null> {
  const result = await listAppDataFiles(client, baseMessageQuery(), {
    pageSize: 1,
    orderBy: "createdTime desc",
  });
  const file = result.files?.[0];
  if (!file) return null;
  const body = await downloadAppDataFile(client, file.id);
  return toPushedMessage<T>(file, body);
}
