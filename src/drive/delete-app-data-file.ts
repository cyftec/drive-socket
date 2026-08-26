import type { DriveClient } from './drive-client.ts';

export async function deleteAppDataFile(client: DriveClient, fileId: string): Promise<void> {
  await client.request(`/files/${fileId}`, { method: 'DELETE' });
}
