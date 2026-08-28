import { NotAuthenticatedError } from "../../errors/not-authenticated-error.ts";
import type { GoogleOAuth } from "../auth/google-oauth.ts";
import {
  DRIVE_API,
  DRIVE_UPLOAD,
  FOLDER_MIME_TYPE,
} from "../constants.ts";
import type {
  DriveFileMetadata,
  FilesDownloadResult,
  FileMetadataField,
} from "../types.ts";
import { parseDriveError } from "./parse-drive-error.ts";

export class GoogleDriveClient {
  constructor(private readonly oauth: GoogleOAuth) {}

  private encodeMultipart(
    metadata: Record<string, unknown>,
    fileBlob: Blob,
    mimeType: string,
  ): Blob {
    const boundary = `drive_socket_${crypto.randomUUID()}`;
    const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
    const filePartHeader = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const closing = `\r\n--${boundary}--`;

    return new Blob([metaPart, filePartHeader, fileBlob, closing], {
      type: `multipart/related; boundary=${boundary}`,
    });
  }

  async request(
    path: string,
    init?: RequestInit,
    base = DRIVE_API,
  ): Promise<Response> {
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

  async ensureAppDataFolder(folderName: string): Promise<string> {
    const escapedName = folderName.replace(/'/g, "\\'");
    const query = `name='${escapedName}' and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`;
    const existing = await this.downloadFiles(query, {
      metadataFields: ["id"] as ["id"],
    });
    const found = existing.files?.[0];
    if (found) return found.id;

    const response = await this.request(
      "/files?fields=id",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: folderName,
          mimeType: FOLDER_MIME_TYPE,
          parents: ["appDataFolder"],
        }),
      },
    );
    const created = (await response.json()) as { id: string };
    return created.id;
  }

  async saveNewFile<F extends FileMetadataField>(
    fileName: string,
    mimeType: string,
    fileBlob: Blob,
    parentFolderId: string,
    metadataFields = ["id", "name", "createdTime", "mimeType", "size"] as F[],
  ): Promise<DriveFileMetadata<F>> {
    const fileMetadata = {
      name: fileName,
      parents: [parentFolderId],
      mimeType,
    };
    const body = this.encodeMultipart(fileMetadata, fileBlob, mimeType);
    const response = await this.request(
      `/files?uploadType=multipart&fields=${metadataFields.join(",")}`,
      { method: "POST", body },
      DRIVE_UPLOAD,
    );
    return await response.json();
  }

  async downloadFiles<F extends FileMetadataField>(
    query: string,
    options: {
      pageToken?: string;
      pageSize?: number;
      orderBy?: string;
      metadataFields?: F[];
    } = {
      metadataFields: ["id", "name", "createdTime", "mimeType", "size"] as F[],
    },
  ): Promise<FilesDownloadResult<F>> {
    const params = new URLSearchParams({
      spaces: "appDataFolder",
      q: query,
      fields: `nextPageToken,files(${(options?.metadataFields || []).join(",")})`,
      pageSize: String(options?.pageSize ?? 100),
    });
    if (options?.orderBy) params.set("orderBy", options.orderBy);
    if (options?.pageToken) params.set("pageToken", options.pageToken);
    const response = await this.request(`/files?${params.toString()}`);
    return await response.json();
  }

  async downloadFile(fileId: string, signal?: AbortSignal): Promise<Blob> {
    const token = this.oauth.getAccessToken();
    if (!token) throw new NotAuthenticatedError();
    const response = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) throw await parseDriveError(response);
    return response.blob();
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.request(`/files/${fileId}`, { method: "DELETE" });
  }

  async fileExists(fileName: string, parentFolderId: string): Promise<boolean> {
    const escapedName = fileName.replace(/'/g, "\\'");
    const query = `name='${escapedName}' and '${parentFolderId}' in parents and trashed=false`;
    const result = await this.downloadFiles(query);
    return (result.files?.length ?? 0) > 0;
  }

  buildFolderQuery(parentFolderId: string): string {
    return `'${parentFolderId}' in parents and trashed=false`;
  }
}
