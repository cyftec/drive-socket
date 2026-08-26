import { InvalidMimeError, MessageExistsError } from "../errors";
import {
  GoogleDriveClient,
  GoogleOAuth,
  isValidMimeType,
  mimeToExtension,
} from "../google";
import type {
  DriveSocketConfig,
  FileMessage,
  FileMessageMetadata,
  PruneOptions,
  PruneResult,
  ReceiveOptions,
} from "../types";
import {
  baseMessageQuery,
  buildBeforeQuery,
  buildReceiveQuery,
  generateMessageFileName,
  sortByCreatedTimeDesc,
} from "./utils";

export class DriveSocket {
  private readonly oauth: GoogleOAuth;
  private readonly gDriveClient: GoogleDriveClient;

  constructor(config: DriveSocketConfig) {
    this.oauth = new GoogleOAuth(config.clientId);
    this.gDriveClient = new GoogleDriveClient(this.oauth);
  }

  private async collectFileMessageMetadata(
    query: string,
    orderBy?: string,
  ): Promise<FileMessageMetadata[]> {
    const metadata: FileMessageMetadata[] = [];
    let pageToken: string | undefined;
    do {
      const result = await this.gDriveClient.downloadFiles(query, {
        pageToken,
        orderBy,
      });
      for (const file of result.files ?? []) metadata.push(file);
      pageToken = result.nextPageToken;
    } while (pageToken);
    return metadata;
  }

  private async deleteFileMessageMetadata(
    metadata: FileMessageMetadata[],
    dryRun?: boolean,
    keptCount = 0,
  ): Promise<PruneResult> {
    if (dryRun) {
      return { deleted: metadata, deletedCount: metadata.length, keptCount };
    }
    for (const file of metadata) await this.gDriveClient.deleteFile(file.id);
    return { deleted: metadata, deletedCount: metadata.length, keptCount };
  }

  connect(): Promise<void> {
    return this.oauth.connect();
  }

  disconnect(): Promise<void> {
    return this.oauth.disconnect();
  }

  isAuthenticated(): boolean {
    return this.oauth.getAccessToken() !== null;
  }

  async push(
    fileBlob: Blob,
    options: { mimeType: string },
  ): Promise<FileMessage> {
    const { mimeType } = options;
    if (!isValidMimeType(mimeType)) {
      throw new InvalidMimeError(mimeType, "not supported");
    }
    const fileName = generateMessageFileName(mimeToExtension(mimeType));
    if (await this.gDriveClient.fileExists(fileName)) {
      throw new MessageExistsError(fileName);
    }
    const metadata = await this.gDriveClient.saveNewFile(
      fileName,
      mimeType,
      fileBlob,
    );
    return { ...metadata, fileBlob };
  }

  async receive(
    options: ReceiveOptions & { as: "file-message-metadata" },
  ): Promise<FileMessageMetadata[]>;
  async receive(
    options: ReceiveOptions & { as: "file-message" },
  ): Promise<FileMessage[]>;
  async receive(
    options: ReceiveOptions,
  ): Promise<FileMessageMetadata[] | FileMessage[]> {
    const metadataList = sortByCreatedTimeDesc(
      await this.collectFileMessageMetadata(
        buildReceiveQuery(options),
        "createdTime desc",
      ),
    );
    const selectedMetadataList = options.limit
      ? metadataList.slice(0, options.limit)
      : metadataList;

    if (options.as === "file-message-metadata") return selectedMetadataList;

    const messages: FileMessage[] = [];
    for (const metadata of selectedMetadataList) {
      const fileBlob = await this.gDriveClient.downloadFile(metadata.id);
      messages.push({ ...metadata, fileBlob });
    }
    return messages;
  }

  async getById(fileId: string): Promise<FileMessage> {
    const response = await this.gDriveClient.request(
      `/files/${fileId}?fields=id,name,createdTime,mimeType,size`,
    );
    const metadata = (await response.json()) as FileMessageMetadata;
    const fileBlob = await this.gDriveClient.downloadFile(fileId);
    return { ...metadata, fileBlob };
  }

  async pruneByCount(
    options: { keep: number } & PruneOptions,
  ): Promise<PruneResult> {
    if (options.keep < 0) throw new RangeError("keep must be >= 0");
    const metadata = sortByCreatedTimeDesc(
      await this.collectFileMessageMetadata(
        baseMessageQuery(),
        "createdTime desc",
      ),
    );
    const toDelete = metadata.slice(options.keep);
    return this.deleteFileMessageMetadata(
      toDelete,
      options.dryRun,
      metadata.length - toDelete.length,
    );
  }

  async pruneBefore(
    options: { before: Date } & PruneOptions,
  ): Promise<PruneResult> {
    const all = await this.collectFileMessageMetadata(baseMessageQuery());
    const toDelete = await this.collectFileMessageMetadata(
      buildBeforeQuery(options.before),
    );
    return this.deleteFileMessageMetadata(
      toDelete,
      options.dryRun,
      all.length - toDelete.length,
    );
  }
}
