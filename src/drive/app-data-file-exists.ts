import type { DriveClient } from './drive-client.ts';
import { listAppDataFiles } from './list-app-data-files.ts';

export async function appDataFileExists(client: DriveClient, fileName: string): Promise<boolean> {
  const result = await listAppDataFiles(client, `name='${fileName.replace(/'/g, "\\'")}'`);
  return (result.files?.length ?? 0) > 0;
}
