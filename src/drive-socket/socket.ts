import { InvalidMimeError, MessageExistsError } from "../errors";
import {
  GoogleDriveClient,
  GoogleOAuth,
  isValidMimeType,
  mimeToExtension,
  type FileMetadataField,
  type TimedFileQuery,
} from "../google";
import type {
  DriveSocketConfig,
  FileMetadata,
  FileMessage,
  PruneOptions,
  PruneResult,
  ReceiveOptions,
} from "../types";

type DefaultFileMetadataFields =
  | "id"
  | "name"
  | "createdTime"
  | "mimeType"
  | "size";

type SocketMetadataFields<F extends FileMetadataField> =
  DefaultFileMetadataFields | F;

export class DriveSocket<F extends FileMetadataField = never> {
  private readonly oauth: GoogleOAuth;
  private readonly gDriveClient: GoogleDriveClient;
  private readonly filenamePrefix = "msg-";
  private readonly baseQuery: string;
  private readonly metadataFields = new Set<FileMetadataField>([
    "id",
    "name",
    "createdTime",
    "mimeType",
    "size",
  ]);

  constructor(
    config: DriveSocketConfig,
    metadataFields?: readonly F[],
  ) {
    this.oauth = new GoogleOAuth(config.clientId);
    this.gDriveClient = new GoogleDriveClient(this.oauth);
    this.baseQuery = this.gDriveClient.buildQuery(this.filenamePrefix);
    metadataFields?.forEach((field) => this.metadataFields.add(field));
  }

  private getTimedQuery(timeQuery?: TimedFileQuery) {
    return this.gDriveClient.buildQuery(this.filenamePrefix, false, timeQuery);
  }

  private async collectFileMessageMetadata(
    query: string,
    orderBy?: string,
  ): Promise<FileMetadata<SocketMetadataFields<F>>[]> {
    const metadata: FileMetadata<SocketMetadataFields<F>>[] = [];
    const metadataFields = [...this.metadataFields] as SocketMetadataFields<F>[];
    let pageToken: string | undefined;
    do {
      const result = await this.gDriveClient.downloadFiles<SocketMetadataFields<F>>(
        query,
        {
          pageToken,
          orderBy,
          metadataFields,
        },
      );
      for (const file of result.files ?? []) metadata.push(file);
      pageToken = result.nextPageToken;
    } while (pageToken);
    return metadata;
  }

  private async deleteFileMessageMetadata(
    metadata: FileMetadata<SocketMetadataFields<F>>[],
    dryRun?: boolean,
    keptCount = 0,
  ): Promise<PruneResult<SocketMetadataFields<F>>> {
    if (dryRun) {
      return { deleted: metadata, deletedCount: metadata.length, keptCount };
    }
    for (const file of metadata) await this.gDriveClient.deleteFile(file.id);
    return { deleted: metadata, deletedCount: metadata.length, keptCount };
  }

  private newFileName(extension: string, length = 8): string {
    const randomSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, length);
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
    return `msg-${timestamp}-${randomSuffix}.${extension}`;
  }

  private sortMetadataFilesByCreatedTimeDesc(
    files: FileMetadata<SocketMetadataFields<F>>[],
  ): FileMetadata<SocketMetadataFields<F>>[] {
    return [...files].sort((a, b) => {
      const timeDiff = b.createdTime.localeCompare(a.createdTime);
      return timeDiff !== 0 ? timeDiff : a.id.localeCompare(b.id);
    });
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
  ): Promise<FileMessage<SocketMetadataFields<F>>> {
    const { mimeType } = options;
    if (!isValidMimeType(mimeType)) {
      throw new InvalidMimeError(mimeType, "not supported");
    }
    const fileName = this.newFileName(mimeToExtension(mimeType));
    if (await this.gDriveClient.fileExists(fileName)) {
      throw new MessageExistsError(fileName);
    }
    const metadata = await this.gDriveClient.saveNewFile<SocketMetadataFields<F>>(
      fileName,
      mimeType,
      fileBlob,
      [...this.metadataFields] as SocketMetadataFields<F>[],
    );
    return { ...metadata, fileBlob };
  }

  async receive(
    options: ReceiveOptions & { as: "file-message-metadata" },
  ): Promise<FileMetadata<SocketMetadataFields<F>>[]>;
  async receive(
    options: ReceiveOptions & { as: "file-message" },
  ): Promise<FileMessage<SocketMetadataFields<F>>[]>;
  async receive(
    options: ReceiveOptions,
  ): Promise<
    FileMetadata<SocketMetadataFields<F>>[] | FileMessage<SocketMetadataFields<F>>[]
  > {
    const metadataList = this.sortMetadataFilesByCreatedTimeDesc(
      await this.collectFileMessageMetadata(
        this.getTimedQuery(options.timeQuery),
        "createdTime desc",
      ),
    );
    const selectedMetadataList = options.limit
      ? metadataList.slice(0, options.limit)
      : metadataList;

    if (options.as === "file-message-metadata") return selectedMetadataList;

    const messages: FileMessage<SocketMetadataFields<F>>[] = [];
    for (const metadata of selectedMetadataList) {
      const fileBlob = await this.gDriveClient.downloadFile(metadata.id);
      messages.push({ ...metadata, fileBlob });
    }
    return messages;
  }

  async getById(fileId: string): Promise<FileMessage<SocketMetadataFields<F>>> {
    const fields = [...this.metadataFields].join(",");
    const response = await this.gDriveClient.request(
      `/files/${fileId}?fields=${fields}`,
    );
    const metadata = (await response.json()) as FileMetadata<
      SocketMetadataFields<F>
    >;
    const fileBlob = await this.gDriveClient.downloadFile(fileId);
    return { ...metadata, fileBlob };
  }

  async pruneByCount(
    options: { keep: number } & PruneOptions,
  ): Promise<PruneResult<SocketMetadataFields<F>>> {
    if (options.keep < 0) throw new RangeError("keep must be >= 0");
    const metadata = this.sortMetadataFilesByCreatedTimeDesc(
      await this.collectFileMessageMetadata(this.baseQuery, "createdTime desc"),
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
  ): Promise<PruneResult<SocketMetadataFields<F>>> {
    const all = await this.collectFileMessageMetadata(this.baseQuery);
    const beforeTimeQuery: TimedFileQuery = {
      date: options.before,
      includingDate: false,
      relation: "until",
    };
    const toDelete = await this.collectFileMessageMetadata(
      this.getTimedQuery(beforeTimeQuery),
    );
    return this.deleteFileMessageMetadata(
      toDelete,
      options.dryRun,
      all.length - toDelete.length,
    );
  }
}
