import { DriveAmbiguousPathError } from "../errors/drive-ambiguous-path-error.ts";
import { DriveApiError } from "../errors/drive-api-error.ts";
import { DriveScopeError } from "../errors/drive-scope-error.ts";
import type { GoogleOAuth } from "./oauth.ts";

export type DriveSpace = "appDataFolder" | "drive";

export interface GoogleDriveFolderConfig {
  oauth: GoogleOAuth;
  space: DriveSpace;
  rootFolderPath: string;
}

type DriveFileEntry = {
  id: string;
  name: string;
  createdTime: string;
  mimeType: string;
};

const METADATA_OPERATIONS_ENDPOINT = "https://www.googleapis.com/drive/v3";
const UPLOAD_OPERATION_ENDPOINT = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

const APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const SPACE_SCOPES: Record<DriveSpace, readonly string[]> = {
  appDataFolder: [APPDATA_SCOPE],
  drive: [DRIVE_FILE_SCOPE],
};

export class GoogleDriveFolder {
  private readonly oauth: GoogleOAuth;
  private readonly space: DriveSpace;
  private readonly spaceRootParentId: string;
  private readonly rootFolderSegments: string[];
  private readonly pathToFolderId = new Map<string, string>();

  private rootFolderId: string | null = null;
  private connected = false;

  constructor(config: GoogleDriveFolderConfig) {
    this.oauth = config.oauth;
    this.space = config.space;
    this.spaceRootParentId =
      config.space === "appDataFolder" ? "appDataFolder" : "root";
    this.rootFolderSegments = GoogleDriveFolder.normalizePath(
      config.rootFolderPath,
    );
    this.assertSpaceScope();
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    let parentId = this.spaceRootParentId;
    let pathKey = "";

    for (const segment of this.rootFolderSegments) {
      parentId = await this.resolveOrCreateFolderSegment(parentId, segment);
      pathKey = pathKey ? `${pathKey}/${segment}` : segment;
      this.pathToFolderId.set(pathKey, parentId);
    }

    this.rootFolderId = parentId;
    this.pathToFolderId.set("", this.rootFolderId);
    this.connected = true;
  }

  async files(subpath = ""): Promise<DriveFileEntry[]> {
    const parentFolderId = await this.resolveFolderId(subpath);
    const query = `'${parentFolderId}' in parents and trashed=false`;
    const entries = await this.queryFiles(query);
    return entries.filter((entry) => entry.mimeType !== FOLDER_MIME_TYPE);
  }

  async read(relativePath: string): Promise<Blob> {
    const { parentFolderId, name } = await this.splitPath(relativePath);
    const file = await this.findFileInParent(parentFolderId, name);
    return (
      await this.request(
        METADATA_OPERATIONS_ENDPOINT,
        `/files/${file.id}?alt=media`,
      )
    ).blob();
  }

  async write(
    relativePath: string,
    fileBlob: Blob,
    mimeType: string,
  ): Promise<Pick<DriveFileEntry, "id" | "name">> {
    const { parentFolderId, name } = await this.splitPathForWrite(relativePath);
    const body = this.encodeMultipart(name, parentFolderId, mimeType, fileBlob);
    const response = await this.request(
      UPLOAD_OPERATION_ENDPOINT,
      "/files?uploadType=multipart&fields=id,name",
      { method: "POST", body },
    );
    return await response.json();
  }

  async exists(relativePath: string): Promise<boolean> {
    const segments = GoogleDriveFolder.normalizePath(relativePath);
    if (segments.length === 0) return true;

    const fileName = segments[segments.length - 1]!;
    const parentPath = segments.slice(0, -1).join("/");

    try {
      const parentFolderId = await this.resolveFolderId(parentPath);
      const escapedName = this.escapeQueryString(fileName);
      const query = `name='${escapedName}' and '${parentFolderId}' in parents and trashed=false`;
      const matches = await this.queryFiles(query);
      return matches.length > 0;
    } catch {
      return false;
    }
  }

  async mkdir(relativePath: string): Promise<void> {
    const segments = GoogleDriveFolder.normalizePath(relativePath);
    if (segments.length === 0) return;

    let parentId = this.rootFolderId!;
    let pathKey = "";

    for (const segment of segments) {
      parentId = await this.resolveOrCreateFolderSegment(parentId, segment);
      pathKey = pathKey ? `${pathKey}/${segment}` : segment;
      this.pathToFolderId.set(pathKey, parentId);
    }
  }

  async deleteById(fileId: string): Promise<void> {
    this.assertConnected();
    await this.request(METADATA_OPERATIONS_ENDPOINT, `/files/${fileId}`, {
      method: "DELETE",
    });
  }

  async deleteByPath(relativePath: string): Promise<void> {
    const { parentFolderId, name } = await this.splitPath(relativePath);
    const file = await this.findFileInParent(parentFolderId, name);
    await this.deleteById(file.id);
  }

  private assertSpaceScope(): void {
    const configuredScopes = new Set(
      this.oauth.getConfiguredScopes().split(/\s+/).filter(Boolean),
    );
    const requiredScopes = SPACE_SCOPES[this.space];
    const hasScope = requiredScopes.some((scope) =>
      configuredScopes.has(scope),
    );
    if (!hasScope) {
      throw new DriveScopeError(this.space, requiredScopes);
    }
  }

  private assertConnected(): void {
    if (!this.connected || this.rootFolderId === null) {
      throw new Error("Not connected. Call connect() first.");
    }
  }

  private async resolveFolderId(subpath: string): Promise<string> {
    this.assertConnected();
    const segments = GoogleDriveFolder.normalizePath(subpath);
    if (segments.length === 0) return this.rootFolderId!;

    const pathKey = segments.join("/");
    const cached = this.pathToFolderId.get(pathKey);
    if (cached) return cached;

    let parentId = this.rootFolderId!;
    let currentPath = "";

    for (const segment of segments) {
      parentId = await this.resolveExistingFolderSegment(parentId, segment);
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      this.pathToFolderId.set(currentPath, parentId);
    }

    return parentId;
  }

  private async splitPath(relativePath: string): Promise<{
    parentFolderId: string;
    name: string;
  }> {
    this.assertConnected();
    const segments = GoogleDriveFolder.normalizePath(relativePath);
    if (segments.length === 0) {
      throw new Error("File path must include a file name");
    }

    const name = segments[segments.length - 1]!;
    const parentPath = segments.slice(0, -1).join("/");
    return {
      parentFolderId: await this.resolveFolderId(parentPath),
      name,
    };
  }

  private async splitPathForWrite(relativePath: string): Promise<{
    parentFolderId: string;
    name: string;
  }> {
    this.assertConnected();
    const segments = GoogleDriveFolder.normalizePath(relativePath);
    if (segments.length === 0) {
      throw new Error("File path must include a file name");
    }

    const name = segments[segments.length - 1]!;
    const parentPath = segments.slice(0, -1).join("/");
    return {
      parentFolderId: await this.resolveOrCreateFolderId(parentPath),
      name,
    };
  }

  private async resolveOrCreateFolderId(subpath: string): Promise<string> {
    this.assertConnected();
    const segments = GoogleDriveFolder.normalizePath(subpath);
    if (segments.length === 0) return this.rootFolderId!;

    const pathKey = segments.join("/");
    const cached = this.pathToFolderId.get(pathKey);
    if (cached) return cached;

    let parentId = this.rootFolderId!;
    let currentPath = "";

    for (const segment of segments) {
      parentId = await this.resolveOrCreateFolderSegment(parentId, segment);
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      this.pathToFolderId.set(currentPath, parentId);
    }

    return parentId;
  }

  private async findFileInParent(
    parentFolderId: string,
    fileName: string,
  ): Promise<DriveFileEntry> {
    const escapedName = this.escapeQueryString(fileName);
    const query = `name='${escapedName}' and '${parentFolderId}' in parents and trashed=false`;
    const matches = await this.queryFiles(query);
    const file = matches.find((entry) => entry.mimeType !== FOLDER_MIME_TYPE);
    if (!file) {
      throw new DriveApiError(`File not found: ${fileName}`, 404, "notFound");
    }
    return file;
  }

  private async resolveOrCreateFolderSegment(
    parentId: string,
    folderName: string,
  ): Promise<string> {
    const matches = await this.findFolderMatches(parentId, folderName);
    if (matches.length > 1) {
      throw new DriveAmbiguousPathError(parentId, folderName);
    }
    if (matches.length === 1) return matches[0]!.id;

    const response = await this.request(
      METADATA_OPERATIONS_ENDPOINT,
      "/files?fields=id",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: folderName,
          mimeType: FOLDER_MIME_TYPE,
          parents: [parentId],
        }),
      },
    );
    const created = (await response.json()) as { id: string };
    return created.id;
  }

  private async resolveExistingFolderSegment(
    parentId: string,
    folderName: string,
  ): Promise<string> {
    const matches = await this.findFolderMatches(parentId, folderName);
    if (matches.length > 1) {
      throw new DriveAmbiguousPathError(parentId, folderName);
    }
    if (matches.length === 1) return matches[0]!.id;

    throw new DriveApiError(`Folder not found: ${folderName}`, 404, "notFound");
  }

  private findFolderMatches(
    parentId: string,
    folderName: string,
  ): Promise<DriveFileEntry[]> {
    const escapedName = this.escapeQueryString(folderName);
    const query = `name='${escapedName}' and '${parentId}' in parents and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`;
    return this.queryFiles(query);
  }

  private async queryFiles(query: string): Promise<DriveFileEntry[]> {
    const files: DriveFileEntry[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        spaces: this.space,
        q: query,
        fields: "nextPageToken,files(id,name,createdTime,mimeType)",
        pageSize: "100",
      });
      if (pageToken) params.set("pageToken", pageToken);

      const response = await this.request(
        METADATA_OPERATIONS_ENDPOINT,
        `/files?${params.toString()}`,
      );
      const result = (await response.json()) as {
        files?: DriveFileEntry[];
        nextPageToken?: string;
      };
      for (const file of result.files ?? []) files.push(file);
      pageToken = result.nextPageToken;
    } while (pageToken);

    return files;
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

  private escapeQueryString(value: string): string {
    return value.replace(/'/g, "\\'");
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

  private static normalizePath(path: string): string[] {
    return path
      .split("/")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
  }
}
