import type { DriveClient } from './drive-client.ts';

export async function downloadAppDataFile(client: DriveClient, fileId: string): Promise<Blob> {
  const response = await client.request(`/files/${fileId}?alt=media`);
  return response.blob();
}
