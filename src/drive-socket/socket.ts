import {
  FilenameExtensionMismatchError,
  InvalidMimeError,
  MessageExistsError,
} from "../errors";
import {
  GoogleDriveClient,
  GoogleOAuth,
  isValidMimeType,
  mimeToExtension,
  type FileMetadataField,
} from "../google";
import type {
  DriveSocketConfig,
  FileMetadata,
  FileMessage,
  OnReceiveEvent,
} from "../types";

type DefaultFileMetadataFields =
  | "id"
  | "name"
  | "createdTime"
  | "mimeType"
  | "size";

type SocketMetadataFields<F extends FileMetadataField> =
  DefaultFileMetadataFields | F;

function tokenStorageKey(clientId: string, folderName: string): string {
  return `drive-socket:tokens:${clientId}:${folderName}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DriveSocket<F extends FileMetadataField = never> {
  private readonly config: DriveSocketConfig<F>;
  private readonly oauth: GoogleOAuth;
  private readonly gDriveClient: GoogleDriveClient;
  private readonly metadataFields = new Set<FileMetadataField>([
    "id",
    "name",
    "createdTime",
    "mimeType",
    "size",
  ]);

  private folderId: string | null = null;
  private pollLoopRunning = false;
  private onReceiveCallback:
    | ((event: OnReceiveEvent<SocketMetadataFields<F>>) => void)
    | null = null;
  private idlePruneScheduled = false;
  private downloadAbortController: AbortController | null = null;

  constructor(config: DriveSocketConfig<F>) {
    if (config.pollIntervalInMs <= 0) {
      throw new RangeError("pollIntervalInMs must be > 0");
    }
    if (config.maxFiles < 0) {
      throw new RangeError("maxFiles must be >= 0");
    }
    if (!config.folderName) {
      throw new RangeError("folderName must not be empty");
    }

    this.config = config;
    this.oauth = new GoogleOAuth(
      config.clientId,
      tokenStorageKey(config.clientId, config.folderName),
    );
    this.oauth.installPersistListeners();
    this.gDriveClient = new GoogleDriveClient(this.oauth);
    config.metadataFields?.forEach((field) => this.metadataFields.add(field));

    this.connect({ interactive: false }).catch(() => {});
  }

  connect(options?: { interactive?: boolean }): Promise<void> {
    return this.oauth.connect(options);
  }

  async disconnect(): Promise<void> {
    this.pollLoopRunning = false;
    this.onReceiveCallback = null;
    if (this.downloadAbortController) {
      this.downloadAbortController.abort();
      this.downloadAbortController = null;
    }
    await this.oauth.disconnect();
    this.folderId = null;
  }

  async push(
    fileBlob: Blob,
    options: { mimeType: string; fileName: string },
  ): Promise<FileMessage<SocketMetadataFields<F>>> {
    const { mimeType, fileName } = options;
    if (!isValidMimeType(mimeType)) {
      throw new InvalidMimeError(mimeType, "not supported");
    }

    const expectedExtension = mimeToExtension(mimeType);
    const fileExtension = fileName.split(".").pop()?.toLowerCase();
    if (fileExtension !== expectedExtension.toLowerCase()) {
      throw new FilenameExtensionMismatchError(
        fileName,
        mimeType,
        expectedExtension,
      );
    }

    const folderId = await this.ensureFolderId();
    if (await this.gDriveClient.fileExists(fileName, folderId)) {
      throw new MessageExistsError(fileName);
    }

    const metadata = await this.gDriveClient.saveNewFile<SocketMetadataFields<F>>(
      fileName,
      mimeType,
      fileBlob,
      folderId,
      [...this.metadataFields] as SocketMetadataFields<F>[],
    );
    this.scheduleIdlePrune();
    return { ...metadata, fileBlob };
  }

  onReceive(
    callback: (event: OnReceiveEvent<SocketMetadataFields<F>>) => void,
  ): void {
    this.onReceiveCallback = callback;
    if (!this.pollLoopRunning) {
      this.pollLoopRunning = true;
      this.runPollLoop();
    }
  }

  private async ensureFolderId(): Promise<string> {
    if (this.folderId) return this.folderId;
    this.folderId = await this.gDriveClient.ensureAppDataFolder(
      this.config.folderName,
    );
    return this.folderId;
  }

  private async collectFileMessageMetadata(
    folderId: string,
    orderBy?: string,
  ): Promise<FileMetadata<SocketMetadataFields<F>>[]> {
    const query = this.gDriveClient.buildFolderQuery(folderId);
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

  private sortMetadataFilesByCreatedTimeDesc(
    files: FileMetadata<SocketMetadataFields<F>>[],
  ): FileMetadata<SocketMetadataFields<F>>[] {
    return [...files].sort((a, b) => {
      const timeDiff = b.createdTime.localeCompare(a.createdTime);
      return timeDiff !== 0 ? timeDiff : a.id.localeCompare(b.id);
    });
  }

  private async runPollLoop(): Promise<void> {
    while (this.pollLoopRunning) {
      const cycleStart = Date.now();

      if (!this.oauth.hasValidAccessToken()) {
        await sleep(this.config.pollIntervalInMs);
        continue;
      }

      try {
        const folderId = await this.ensureFolderId();
        const metadataList = this.sortMetadataFilesByCreatedTimeDesc(
          await this.collectFileMessageMetadata(folderId, "createdTime desc"),
        );

        if (this.onReceiveCallback) {
          this.onReceiveCallback({ type: "metadata", files: metadataList });
        }
        this.scheduleIdlePrune();

        let overrun = false;
        for (const metadata of metadataList) {
          if (Date.now() - cycleStart >= this.config.pollIntervalInMs) {
            overrun = true;
            break;
          }

          if (this.downloadAbortController) {
            this.downloadAbortController.abort();
          }
          this.downloadAbortController = new AbortController();
          const signal = this.downloadAbortController.signal;

          try {
            const fileBlob = await this.gDriveClient.downloadFile(
              metadata.id,
              signal,
            );
            if (this.onReceiveCallback) {
              this.onReceiveCallback({
                type: "file",
                message: { ...metadata, fileBlob },
              });
            }
            this.scheduleIdlePrune();
          } catch (error) {
            if (signal.aborted) {
              overrun = true;
              break;
            }
            throw error;
          }

          if (Date.now() - cycleStart >= this.config.pollIntervalInMs) {
            overrun = true;
            break;
          }
        }

        this.downloadAbortController = null;

        if (!overrun) {
          const elapsed = Date.now() - cycleStart;
          if (elapsed < this.config.pollIntervalInMs) {
            await sleep(this.config.pollIntervalInMs - elapsed);
          }
        }
      } catch {
        await sleep(this.config.pollIntervalInMs);
      }
    }
  }

  private scheduleIdlePrune(): void {
    if (this.idlePruneScheduled) return;
    this.idlePruneScheduled = true;

    const run = () => {
      this.idlePruneScheduled = false;
      this.pruneToMaxFiles().catch(() => {});
    };

    const scheduleIdle = globalThis.requestIdleCallback;
    if (typeof scheduleIdle !== "undefined") {
      scheduleIdle(run, { timeout: 30_000 });
    } else {
      setTimeout(run, 1_000);
    }
  }

  private async pruneToMaxFiles(): Promise<void> {
    if (!this.oauth.hasValidAccessToken()) return;

    const folderId = await this.ensureFolderId();
    const metadata = this.sortMetadataFilesByCreatedTimeDesc(
      await this.collectFileMessageMetadata(folderId, "createdTime desc"),
    );

    if (metadata.length <= this.config.maxFiles) return;

    const toDelete = metadata.slice(this.config.maxFiles);
    for (const file of toDelete) {
      await this.gDriveClient.deleteFile(file.id);
    }
  }
}
