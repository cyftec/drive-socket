import {
  FilenameExtensionMismatchError,
  InvalidMimeError,
  MessageExistsError,
} from "../errors";
import { GoogleDriveClient } from "../google/drive/drive-client.ts";
import { GoogleOAuth } from "../google/auth/google-oauth.ts";
import { isValidMimeType, mimeToExtension } from "../google/mime-helpers.ts";
import type { DriveMessage, DriveSocketConfig } from "../types";

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
  private onReceiveCallback: ((messages: DriveMessage[]) => void) | null = null;
  private idlePruneScheduled = false;

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

  connect(options?: { interactive?: boolean }): Promise<void> {
    return this.oauth.connect(options);
  }

  async disconnect(): Promise<void> {
    this.pollLoopRunning = false;
    this.onReceiveCallback = null;
    await this.oauth.disconnect();
    this.folderId = null;
  }

  async push(
    fileBlob: Blob,
    options: { mimeType: string; fileName: string },
  ): Promise<DriveMessage> {
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

    const saved = await this.gDriveClient.saveNewFile(
      fileName,
      mimeType,
      fileBlob,
      folderId,
    );
    this.scheduleIdlePrune();
    return { ...saved, fileBlob };
  }

  onReceive(callback: (messages: DriveMessage[]) => void): void {
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
    const messages: DriveMessage[] = [];

    for (const file of files) {
      const fileBlob = await this.gDriveClient.downloadFile(file.id);
      messages.push({ id: file.id, name: file.name, fileBlob });
    }

    return messages;
  }

  private async runPollLoop(): Promise<void> {
    while (this.pollLoopRunning) {
      const cycleStart = Date.now();

      try {
        await this.oauth.ensureAccessToken();
      } catch {
        await sleep(this.config.pollIntervalInMs);
        continue;
      }

      try {
        const folderId = await this.ensureFolderId();
        const messages = await this.downloadFolderMessages(folderId);

        if (this.onReceiveCallback) {
          this.onReceiveCallback(messages);
        }
        this.scheduleIdlePrune();

        const elapsed = Date.now() - cycleStart;
        if (elapsed < this.config.pollIntervalInMs) {
          await sleep(this.config.pollIntervalInMs - elapsed);
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
