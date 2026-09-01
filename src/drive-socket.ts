import {
  FilenameExtensionMismatchError,
  InvalidMimeError,
  MessageExistsError,
} from "./errors/index.ts";
import {
  GoogleDriveClient,
  GoogleOAuth,
  mimeToExtension,
  supportedMimeType,
} from "./google";

export interface DriveMessage {
  id: string;
  name: string;
  fileBlob: Blob;
  isError?: boolean;
}

export interface DriveSocketConfig {
  clientId: string;
  folderName: string;
  pollIntervalInMs: number;
  maxFiles: number;
}

function tokenStorageKey(clientId: string, folderName: string): string {
  return `drive-socket:tokens:${clientId}:${folderName}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function folderFilesQuery(parentFolderId: string): string {
  return `'${parentFolderId}' in parents and trashed=false`;
}

export class DriveSocket {
  private readonly config: DriveSocketConfig;
  private readonly oauth: GoogleOAuth;
  private readonly gDriveClient: GoogleDriveClient;

  private folderId: string | null = null;
  private pollLoopRunning = false;
  private pollLoopTask: Promise<void> | null = null;
  private onReceiveCallback: ((messages: DriveMessage[]) => void) | null = null;

  constructor(config: DriveSocketConfig) {
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
    this.gDriveClient = new GoogleDriveClient(this.oauth);

    this.connect({ interactive: false }).catch(() => {});
  }

  async connect(options?: { interactive?: boolean }): Promise<void> {
    await this.oauth.connect(options);
    await this.ensureFolderId();
  }

  async disconnect(): Promise<void> {
    this.pollLoopRunning = false;
    this.onReceiveCallback = null;
    await this.oauth.disconnect();
    this.folderId = null;
  }

  get isRunning(): boolean {
    return this.pollLoopRunning;
  }

  pause(): void {
    this.pollLoopRunning = false;
  }

  start(): void {
    if (!this.folderId) {
      throw new Error("Not connected. Call connect() first.");
    }
    if (!this.onReceiveCallback) {
      throw new Error(
        "No receive callback registered. Call onReceive() first.",
      );
    }

    this.pollLoopRunning = true;
    if (!this.pollLoopTask) {
      this.pollLoopTask = this.runPollLoop().finally(() => {
        this.pollLoopTask = null;
      });
    }
  }

  async push(
    fileBlob: Blob,
    options: { mimeType: string; fileName: string },
  ): Promise<DriveMessage> {
    const { mimeType, fileName } = options;
    if (!supportedMimeType(mimeType)) {
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

    const saved = await this.gDriveClient.saveNewFile(
      fileName,
      mimeType,
      fileBlob,
      folderId,
    );
    this.pruneToMaxFiles().catch(() => {});
    return { ...saved, fileBlob };
  }

  async delete(messageId: string): Promise<void> {
    await this.ensureFolderId();
    await this.gDriveClient.deleteFile(messageId);
  }

  onReceive(callback: (messages: DriveMessage[]) => void): void {
    this.onReceiveCallback = callback;
  }

  private async ensureFolderId(): Promise<string> {
    if (this.folderId) return this.folderId;
    this.folderId = await this.gDriveClient.ensureAppDataFolder(
      this.config.folderName,
    );
    return this.folderId;
  }

  private sortFilesByCreatedTimeDesc<
    T extends { id: string; createdTime: string },
  >(files: T[]): T[] {
    return [...files].sort((a, b) => {
      const timeDiff = b.createdTime.localeCompare(a.createdTime);
      return timeDiff !== 0 ? timeDiff : a.id.localeCompare(b.id);
    });
  }

  private async downloadFolderMessages(
    folderId: string,
  ): Promise<DriveMessage[]> {
    const files = this.sortFilesByCreatedTimeDesc(
      await this.gDriveClient.listAllFiles(folderFilesQuery(folderId)),
    );
    return Promise.all(
      files.map(async (file) => {
        try {
          const fileBlob = await this.gDriveClient.downloadFile(file.id);
          return { id: file.id, name: file.name, fileBlob };
        } catch {
          return {
            id: file.id,
            name: file.name,
            fileBlob: new Blob(),
            isError: true,
          };
        }
      }),
    );
  }

  private async runPollLoop(): Promise<void> {
    while (this.pollLoopRunning) {
      if (!this.folderId || !this.onReceiveCallback) break;

      try {
        await this.oauth.ensureAccessToken();
      } catch {
        await sleep(this.config.pollIntervalInMs);
        continue;
      }

      try {
        const messages = await this.downloadFolderMessages(this.folderId);

        if (this.onReceiveCallback) {
          this.onReceiveCallback(messages);
        }
      } catch {
        // wait full interval before retrying
      }

      await sleep(this.config.pollIntervalInMs);
    }
  }

  private async pruneToMaxFiles(): Promise<void> {
    try {
      await this.oauth.ensureAccessToken();
    } catch {
      return;
    }

    const folderId = await this.ensureFolderId();
    const files = this.sortFilesByCreatedTimeDesc(
      await this.gDriveClient.listAllFiles(folderFilesQuery(folderId)),
    );

    if (files.length <= this.config.maxFiles) return;

    const toDelete = files.slice(this.config.maxFiles);
    for (const file of toDelete) {
      await this.gDriveClient.deleteFile(file.id);
    }
  }
}
