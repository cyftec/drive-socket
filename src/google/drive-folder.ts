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

type DriveContext = Pick<GoogleDriveFolderConfig, "oauth" | "space">;

type ResolvedRootFolder = {
  rootFolderId: string;
  pathToFolderIdMap: Map<string, string>;
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

function normalizePath(path: string): string[] {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function assertSpaceScope(config: GoogleDriveFolderConfig): void {
  const configuredScopes = new Set(
    config.oauth.getConfiguredScopes().split(/\s+/).filter(Boolean),
  );
  const requiredScopes = SPACE_SCOPES[config.space];
  const hasScope = requiredScopes.some((scope) =>
    configuredScopes.has(scope),
  );
  if (!hasScope) {
    throw new DriveScopeError(config.space, requiredScopes);
  }
}

async function parseDriveError(response: Response): Promise<DriveApiError> {
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

async function driveRequest(
  oauth: GoogleOAuth,
  driveOperationEndpoint: string,
  driveOperationSubpath: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await oauth.authorizedFetch(
    `${driveOperationEndpoint}${driveOperationSubpath}`,
    init,
  );
  if (!response.ok) {
    throw await parseDriveError(response);
  }
  return response;
}

async function queryFiles(
  ctx: DriveContext,
  query: string,
): Promise<DriveFileEntry[]> {
  const files: DriveFileEntry[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      spaces: ctx.space,
      q: query,
      fields: "nextPageToken,files(id,name,createdTime,mimeType)",
      pageSize: "100",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await driveRequest(
      ctx.oauth,
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

function findFolderMatches(
  ctx: DriveContext,
  folderId: string,
  folderName: string,
): Promise<DriveFileEntry[]> {
  const escapedName = folderName.replace(/'/g, "\\'");
  const query = `name='${escapedName}' and '${folderId}' in parents and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`;
  return queryFiles(ctx, query);
}

async function folderSegmentId(
  ctx: DriveContext,
  parentId: string,
  folderName: string,
  createMissing: boolean,
): Promise<string> {
  const matches = await findFolderMatches(ctx, parentId, folderName);
  if (matches.length > 1) {
    throw new DriveAmbiguousPathError(parentId, folderName);
  }
  if (matches.length === 1) return matches[0]!.id;
  if (!createMissing) {
    throw new DriveApiError(`Folder not found: ${folderName}`, 404, "notFound");
  }

  const response = await driveRequest(
    ctx.oauth,
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

async function walkFolderPath(
  ctx: DriveContext,
  startFolderId: string,
  segments: string[],
  pathToFolderIdMap: Map<string, string>,
  createMissing: boolean,
): Promise<string> {
  let folderId = startFolderId;
  let currentPath = "";

  for (const segment of segments) {
    folderId = await folderSegmentId(ctx, folderId, segment, createMissing);
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    pathToFolderIdMap.set(currentPath, folderId);
  }

  return folderId;
}

async function resolveRootFolder(
  config: GoogleDriveFolderConfig,
): Promise<ResolvedRootFolder> {
  const ctx = { oauth: config.oauth, space: config.space };
  const segments = normalizePath(config.rootFolderPath);
  const pathToFolderIdMap = new Map<string, string>();
  const spaceRootParentId =
    config.space === "appDataFolder" ? "appDataFolder" : "root";

  const rootFolderId =
    segments.length === 0
      ? spaceRootParentId
      : await walkFolderPath(
          ctx,
          spaceRootParentId,
          segments,
          pathToFolderIdMap,
          true,
        );

  pathToFolderIdMap.set("", rootFolderId);

  return { rootFolderId, pathToFolderIdMap };
}

export class GoogleDriveFolder {
  private readonly ctx: DriveContext;
  private readonly rootFolderId: string;
  private readonly pathToFolderIdMap: Map<string, string>;

  private constructor(
    config: GoogleDriveFolderConfig,
    resolvedRoot: ResolvedRootFolder,
  ) {
    this.ctx = { oauth: config.oauth, space: config.space };
    this.rootFolderId = resolvedRoot.rootFolderId;
    this.pathToFolderIdMap = resolvedRoot.pathToFolderIdMap;
  }

  static async getFolderHandle(
    config: GoogleDriveFolderConfig,
  ): Promise<GoogleDriveFolder> {
    assertSpaceScope(config);
    const resolvedRoot = await resolveRootFolder(config);
    return new GoogleDriveFolder(config, resolvedRoot);
  }

  async files(subpath = ""): Promise<DriveFileEntry[]> {
    const parentFolderId = await this.folderIdForPath(subpath, false);
    const query = `'${parentFolderId}' in parents and trashed=false`;
    const entries = await queryFiles(this.ctx, query);
    return entries.filter((entry) => entry.mimeType !== FOLDER_MIME_TYPE);
  }

  async read(relativePath: string): Promise<Blob> {
    const { parentFolderId, name } = await this.splitPath(relativePath, false);
    const file = await this.findFileInParent(parentFolderId, name);
    return (
      await driveRequest(
        this.ctx.oauth,
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
    const { parentFolderId, name } = await this.splitPath(relativePath, true);
    const body = this.encodeMultipart(name, parentFolderId, mimeType, fileBlob);
    const response = await driveRequest(
      this.ctx.oauth,
      UPLOAD_OPERATION_ENDPOINT,
      "/files?uploadType=multipart&fields=id,name",
      { method: "POST", body },
    );
    return await response.json();
  }

  async exists(relativePath: string): Promise<boolean> {
    const segments = normalizePath(relativePath);
    if (segments.length === 0) return true;

    const fileName = segments.at(-1)!;
    const parentPath = segments.slice(0, -1).join("/");

    try {
      const parentFolderId = await this.folderIdForPath(parentPath, false);
      const escapedName = fileName.replace(/'/g, "\\'");
      const query = `name='${escapedName}' and '${parentFolderId}' in parents and trashed=false`;
      const matches = await queryFiles(this.ctx, query);
      return matches.length > 0;
    } catch {
      return false;
    }
  }

  async mkdir(relativePath: string): Promise<void> {
    await this.folderIdForPath(relativePath, true);
  }

  async deleteById(fileId: string): Promise<void> {
    await driveRequest(
      this.ctx.oauth,
      METADATA_OPERATIONS_ENDPOINT,
      `/files/${fileId}`,
      { method: "DELETE" },
    );
  }

  async deleteByPath(relativePath: string): Promise<void> {
    const { parentFolderId, name } = await this.splitPath(relativePath, false);
    const file = await this.findFileInParent(parentFolderId, name);
    await this.deleteById(file.id);
  }

  private async folderIdForPath(
    subpath: string,
    createMissing: boolean,
  ): Promise<string> {
    const segments = normalizePath(subpath);
    if (segments.length === 0) return this.rootFolderId;

    const folderPath = segments.join("/");
    const cachedFolderId = this.pathToFolderIdMap.get(folderPath);
    if (cachedFolderId) return cachedFolderId;

    return walkFolderPath(
      this.ctx,
      this.rootFolderId,
      segments,
      this.pathToFolderIdMap,
      createMissing,
    );
  }

  private async splitPath(
    relativePath: string,
    createParents: boolean,
  ): Promise<{
    parentFolderId: string;
    name: string;
  }> {
    const segments = normalizePath(relativePath);
    if (segments.length === 0) {
      throw new Error("File path must include a file name");
    }

    const name = segments.at(-1)!;
    const parentPath = segments.slice(0, -1).join("/");
    return {
      parentFolderId: await this.folderIdForPath(parentPath, createParents),
      name,
    };
  }

  private async findFileInParent(
    parentFolderId: string,
    fileName: string,
  ): Promise<DriveFileEntry> {
    const escapedName = fileName.replace(/'/g, "\\'");
    const query = `name='${escapedName}' and '${parentFolderId}' in parents and trashed=false`;
    const matches = await queryFiles(this.ctx, query);
    const file = matches.find((entry) => entry.mimeType !== FOLDER_MIME_TYPE);
    if (!file) {
      throw new DriveApiError(`File not found: ${fileName}`, 404, "notFound");
    }
    return file;
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
}
