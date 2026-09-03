import {
  FilenameExtensionMismatchError,
  InvalidMimeError,
  MessageExistsError,
} from "./errors/index.ts";
import {
  GoogleDriveFolder,
  mimeToExtension,
  supportedMimeType,
  type DriveSpace,
  type GoogleOAuth,
} from "./google";

export interface DriveMessage {
  id: string;
  name: string;
  fileBlob: Blob;
  isError?: boolean;
}

export type DriveSocketClientType = "single-tenant" | "multi-tenant";

export interface DriveSocketConfig {
  clientType: DriveSocketClientType;
  rootPath: string;
  pollIntervalInMs: number;
  maxFiles: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spaceForClientType(clientType: DriveSocketClientType): DriveSpace {
  return clientType === "single-tenant" ? "appDataFolder" : "drive";
}

export class DriveSocket {
  private readonly folder: GoogleDriveFolder;

  private connected = false;
  private pollLoopRunning = false;
  private pollLoopTask: Promise<void> | null = null;
  private onReceiveCallback: ((messages: DriveMessage[]) => void) | null = null;

  constructor(
    private readonly config: DriveSocketConfig,
    oauth: GoogleOAuth,
  ) {
    if (config.pollIntervalInMs <= 0) {
      throw new RangeError("pollIntervalInMs must be > 0");
    }
    if (config.maxFiles < 0) {
      throw new RangeError("maxFiles must be >= 0");
    }
    if (!config.rootPath) {
      throw new RangeError("rootPath must not be empty");
    }

    this.folder = new GoogleDriveFolder({
      oauth,
      space: spaceForClientType(config.clientType),
      rootFolderPath: config.rootPath,
    });
  }

  async connect(): Promise<void> {
    await this.folder.connect();
    this.connected = true;
  }

  onReceive(callback: (messages: DriveMessage[]) => void): void {
    this.onReceiveCallback = callback;
  }

  async disconnect(): Promise<void> {
    this.pollLoopRunning = false;
    this.onReceiveCallback = null;
    this.connected = false;
  }

  get isRunning(): boolean {
    return this.pollLoopRunning;
  }

  pause(): void {
    this.pollLoopRunning = false;
  }

  start(): void {
    this.assertConnected();
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

    this.assertConnected();
    if (await this.folder.exists(fileName)) {
      throw new MessageExistsError(fileName);
    }

    const saved = await this.folder.write(fileName, fileBlob, mimeType);
    this.pruneToMaxFiles().catch(() => {});
    return { ...saved, fileBlob };
  }

  async delete(messageId: string): Promise<void> {
    this.assertConnected();
    await this.folder.deleteById(messageId);
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new Error("Not connected. Call connect() first.");
    }
  }

  private async pruneToMaxFiles(): Promise<void> {
    const files = this.sortFilesByCreatedTimeDesc(await this.folder.files());

    if (files.length <= this.config.maxFiles) return;

    const toDelete = files.slice(this.config.maxFiles);
    for (const file of toDelete) {
      await this.folder.deleteById(file.id);
    }
  }

  private sortFilesByCreatedTimeDesc<
    T extends { id: string; createdTime: string },
  >(files: T[]): T[] {
    return [...files].sort((a, b) => {
      const timeDiff = b.createdTime.localeCompare(a.createdTime);
      return timeDiff !== 0 ? timeDiff : a.id.localeCompare(b.id);
    });
  }

  private async downloadFolderMessages(): Promise<DriveMessage[]> {
    const files = this.sortFilesByCreatedTimeDesc(await this.folder.files());
    return Promise.all(
      files.map(async (file) => {
        try {
          const fileBlob = await this.folder.read(file.name);
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
      if (!this.connected || !this.onReceiveCallback) break;
      try {
        const messages = await this.downloadFolderMessages();

        if (this.onReceiveCallback) {
          this.onReceiveCallback(messages);
        }
      } catch {
        // wait full interval before retrying
      }

      await sleep(this.config.pollIntervalInMs);
    }
  }
}
