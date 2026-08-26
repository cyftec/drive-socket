import type { DriveClient } from './drive-client.ts';
import type { DriveFileMetadata } from '../types/index.ts';

interface ListFilesResult {
  files?: DriveFileMetadata[];
  nextPageToken?: string;
}

export async function listAppDataFiles(
  client: DriveClient,
  query: string,
  options?: { pageToken?: string; pageSize?: number; orderBy?: string },
): Promise<ListFilesResult> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: query,
    fields: 'nextPageToken,files(id,name,createdTime,mimeType,size)',
    pageSize: String(options?.pageSize ?? 100),
  });
  if (options?.orderBy) params.set('orderBy', options.orderBy);
  if (options?.pageToken) params.set('pageToken', options.pageToken);
  const response = await client.request(`/files?${params.toString()}`);
  return (await response.json()) as ListFilesResult;
}
