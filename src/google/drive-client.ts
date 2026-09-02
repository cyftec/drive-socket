import { DriveApiError } from "../errors/drive-api-error.ts";
import type { GoogleOAuth } from "./oauth.ts";

type ListedDriveFile = {
  id: string;
  name: string;
  createdTime: string;
};

const METADATA_OPERATIONS_ENDPOINT = "https://www.googleapis.com/drive/v3";
const UPLOAD_OPERATION_ENDPOINT = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export class GoogleDriveClient {
  constructor(private readonly oauth: GoogleOAuth) {}

  async ensureAppDataFolder(folderName: string): Promise<string> {
    const escapedName = folderName.replace(/'/g, "\\'");
    const query = `name='${escapedName}' and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`;
    const existing = await this.listAllFiles(query);
    const found = existing[0];
    if (found) return found.id;

    const response = await this.request(
      METADATA_OPERATIONS_ENDPOINT,
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

  async saveNewFile(
    fileName: string,
    mimeType: string,
    fileBlob: Blob,
    parentFolderId: string,
  ): Promise<Pick<ListedDriveFile, "id" | "name">> {
    const body = this.encodeMultipart(
      fileName,
      parentFolderId,
      mimeType,
      fileBlob,
    );
    const response = await this.request(
      UPLOAD_OPERATION_ENDPOINT,
      "/files?uploadType=multipart&fields=id,name",
      { method: "POST", body },
    );
    return await response.json();
  }

  async listAllFiles(query: string): Promise<ListedDriveFile[]> {
    const files: ListedDriveFile[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        spaces: "appDataFolder",
        q: query,
        fields: "nextPageToken,files(id,name,createdTime)",
        pageSize: "100",
      });
      if (pageToken) params.set("pageToken", pageToken);

      const response = await this.request(
        METADATA_OPERATIONS_ENDPOINT,
        `/files?${params.toString()}`,
      );
      const result = (await response.json()) as {
        files?: ListedDriveFile[];
        nextPageToken?: string;
      };
      for (const file of result.files ?? []) files.push(file);
      pageToken = result.nextPageToken;
    } while (pageToken);

    return files;
  }

  async downloadFile(fileId: string): Promise<Blob> {
    return (
      await this.request(
        METADATA_OPERATIONS_ENDPOINT,
        `/files/${fileId}?alt=media`,
      )
    ).blob();
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.request(METADATA_OPERATIONS_ENDPOINT, `/files/${fileId}`, {
      method: "DELETE",
    });
  }

  async fileExists(fileName: string, parentFolderId: string): Promise<boolean> {
    const escapedName = fileName.replace(/'/g, "\\'");
    const query = `name='${escapedName}' and '${parentFolderId}' in parents and trashed=false`;
    const files = await this.listAllFiles(query);
    return files.length > 0;
  }

  private encodeMultipart(
    fileName: string,
    parentFolderId: string,
    mimeType: string,
    fileBlob: Blob,
  ): Blob {
    const boundary = `drive_socket_${crypto.randomUUID()}`;
    const filePart = {
      name: fileName,
      parents: [parentFolderId],
      mimeType,
    };
    const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(filePart)}\r\n`;
    const filePartHeader = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const closing = `\r\n--${boundary}--`;

    return new Blob([metaPart, filePartHeader, fileBlob, closing], {
      type: `multipart/related; boundary=${boundary}`,
    });
  }

  private async parseDriveError(response: Response): Promise<DriveApiError> {
    let message = `Drive API error: ${response.status}`;
    let reason = "unknown";
    try {
      const body = (await response.json()) as {
        error?: { message?: string; errors?: Array<{ reason?: string }> };
      };
      message = body.error?.message ?? message;
      reason = body.error?.errors?.[0]?.reason ?? reason;
    } catch {
      // keep defaults
    }
    return new DriveApiError(message, response.status, reason);
  }

  private async request(
    driveOperationEndpoint: string,
    driveOperationSubpath: string,
    init?: RequestInit,
  ): Promise<Response> {
    const response = await this.oauth.authorizedFetch(
      `${driveOperationEndpoint}${driveOperationSubpath}`,
      init,
    );
    if (!response.ok) throw await this.parseDriveError(response);
    return response;
  }
}
