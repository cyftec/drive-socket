import { NotAuthenticatedError } from '../errors/not-authenticated-error.ts';
import type { GoogleOAuth } from '../auth/google-oauth.ts';
import type { DriveFileMetadata } from '../types/index.ts';
import { encodeMultipart } from '../messages/multipart/encode-multipart.ts';
import { parseDriveError } from './parse-drive-error.ts';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

interface ListFilesResult {
  files?: DriveFileMetadata[];
  nextPageToken?: string;
}

export class DriveClient {
  constructor(private readonly oauth: GoogleOAuth) {}

  async request(path: string, init?: RequestInit, base = DRIVE_API): Promise<Response> {
    const token = this.oauth.getAccessToken();
    if (!token) throw new NotAuthenticatedError();
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
    });
    if (!response.ok) throw await parseDriveError(response);
    return response;
  }

  async createAppDataFile(
    fileName: string,
    mimeType: string,
    content: Blob | ArrayBuffer | Uint8Array,
  ): Promise<DriveFileMetadata> {
    const metadata = { name: fileName, parents: ['appDataFolder'], mimeType };
    const { body } = encodeMultipart(metadata, content, mimeType);
    const response = await this.request(
      '/files?uploadType=multipart&fields=id,name,createdTime,mimeType,size',
      { method: 'POST', body },
      DRIVE_UPLOAD,
    );
    return (await response.json()) as DriveFileMetadata;
  }

  async listAppDataFiles(
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
    const response = await this.request(`/files?${params.toString()}`);
    return (await response.json()) as ListFilesResult;
  }

  async downloadAppDataFile(fileId: string): Promise<Blob> {
    const response = await this.request(`/files/${fileId}?alt=media`);
    return response.blob();
  }

  async deleteAppDataFile(fileId: string): Promise<void> {
    await this.request(`/files/${fileId}`, { method: 'DELETE' });
  }

  async appDataFileExists(fileName: string): Promise<boolean> {
    const result = await this.listAppDataFiles(`name='${fileName.replace(/'/g, "\\'")}'`);
    return (result.files?.length ?? 0) > 0;
  }
}
