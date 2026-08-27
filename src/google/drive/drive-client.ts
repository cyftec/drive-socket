import { NotAuthenticatedError } from "../../errors/not-authenticated-error.ts";
import type { GoogleOAuth } from "../auth/google-oauth.ts";
import { DRIVE_API, DRIVE_UPLOAD } from "../constants.ts";
import type {
  DriveFileMetadata,
  FilesDownloadResult,
  FileMetadataField,
  TimedFileQuery,
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

  buildQuery(contains: string, trashed = false, timeQuery?: TimedFileQuery) {
    const baseQuery = `name contains '${contains}' and trashed=${trashed}`;
    if (!timeQuery) return baseQuery;

    const exclusiveTimeComparison = timeQuery.relation === "since" ? ">" : "<";
    const timeComparison =
      exclusiveTimeComparison + (timeQuery.includingDate ? "=" : "");
    const dateISO = timeQuery.date.toISOString();

    return `${baseQuery} and createdTime ${timeComparison} '${dateISO}'`;
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

  async saveNewFile<F extends FileMetadataField>(
    fileName: string,
    mimeType: string,
    fileBlob: Blob,
    metadataFields = ["id", "name", "createdTime", "mimeType", "size"] as F[],
  ): Promise<DriveFileMetadata<F>> {
    const fileMetadata = {
      name: fileName,
      parents: ["appDataFolder"],
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

  async downloadFile(fileId: string): Promise<Blob> {
    const response = await this.request(`/files/${fileId}?alt=media`);
    return response.blob();
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.request(`/files/${fileId}`, { method: "DELETE" });
  }

  async fileExists(fileName: string): Promise<boolean> {
    const result = await this.downloadFiles(
      `name='${fileName.replace(/'/g, "\\'")}'`,
    );
    return (result.files?.length ?? 0) > 0;
  }
}
