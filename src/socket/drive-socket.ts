import { GoogleOAuth } from "../auth/google-oauth.ts";
import { DriveClient } from "../drive/drive-client.ts";
import { InvalidMimeError } from "../errors/invalid-mime-error.ts";
import { MessageExistsError } from "../errors/message-exists-error.ts";
import { toBlob } from "../messages/blob/to-blob.ts";
import { generateMessageFileName } from "../messages/filename/generate-message-file-name.ts";
import { isValidMimeType } from "../messages/mime/is-valid-mime-type.ts";
import { mimeToExtension } from "../messages/mime/mime-to-extension.ts";
import { filterByKind } from "../messages/parser/filter-by-kind.ts";
import { sortByCreatedTimeDesc } from "../messages/parser/sort-by-created-time-desc.ts";
import { toMessageRef } from "../messages/parser/to-message-ref.ts";
import { toPushedMessage } from "../messages/parser/to-pushed-message.ts";
import {
  baseMessageQuery,
  buildBeforeQuery,
  buildListQuery,
} from "../messages/query-helpers.ts";
import type {
  DriveSocketConfig,
  ListOptions,
  MessageRef,
  PruneOptions,
  PruneResult,
  PushedMessage,
  PushedMessageFile,
  PushedMessageJson,
} from "../types/index.ts";

export class DriveSocket {
  private readonly oauth: GoogleOAuth;
  private readonly client: DriveClient;

  constructor(config: DriveSocketConfig) {
    this.oauth = new GoogleOAuth(config.clientId);
    this.client = new DriveClient(this.oauth);
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

  async pushJson<T>(payload: T): Promise<PushedMessageJson<T>> {
    const fileName = generateMessageFileName("json");
    if (await this.client.appDataFileExists(fileName)) {
      throw new MessageExistsError(fileName);
    }
    const content = new Blob([JSON.stringify(payload)], {
      type: "application/json",
    });
    const file = await this.client.createAppDataFile(
      fileName,
      "application/json",
      content,
    );
    const message = await toPushedMessage<T>(file, content);
    if (message.kind !== "json") throw new Error("Expected JSON message");
    return message;
  }

  async pushFile(
    data: Blob | ArrayBuffer | Uint8Array,
    options: { mimeType: string },
  ): Promise<PushedMessageFile> {
    const { mimeType } = options;
    if (mimeType === "application/json") {
      throw new InvalidMimeError(mimeType, "use pushJson() for JSON payloads");
    }
    if (!isValidMimeType(mimeType)) {
      throw new InvalidMimeError(mimeType, "must match type/subtype format");
    }
    const fileName = generateMessageFileName(mimeToExtension(mimeType));
    if (await this.client.appDataFileExists(fileName)) {
      throw new MessageExistsError(fileName);
    }
    const content = toBlob(data, mimeType);
    const file = await this.client.createAppDataFile(
      fileName,
      mimeType,
      content,
    );
    const message = await toPushedMessage(file, content);
    if (message.kind !== "file") throw new Error("Expected file message");
    return message;
  }

  async getLatest<T = unknown>(): Promise<PushedMessage<T> | null> {
    const result = await this.client.listAppDataFiles(baseMessageQuery(), {
      pageSize: 1,
      orderBy: "createdTime desc",
    });
    const file = result.files?.[0];
    if (!file) return null;
    const body = await this.client.downloadAppDataFile(file.id);
    return toPushedMessage<T>(file, body);
  }

  async list(options?: ListOptions): Promise<MessageRef[]> {
    const refs = await this.collectMessageRefs(
      buildListQuery(options),
      "createdTime desc",
    );
    const filtered = filterByKind(refs, options?.kind);
    const sorted = sortByCreatedTimeDesc(filtered);
    return options?.limit ? sorted.slice(0, options.limit) : sorted;
  }

  async getById<T = unknown>(fileId: string): Promise<PushedMessage<T>> {
    const response = await this.client.request(
      `/files/${fileId}?fields=id,name,createdTime,mimeType,size`,
    );
    const file = await response.json();
    const body = await this.client.downloadAppDataFile(fileId);
    return toPushedMessage<T>(file, body);
  }

  async pruneByCount(
    options: { keep: number } & PruneOptions,
  ): Promise<PruneResult> {
    if (options.keep < 0) throw new RangeError("keep must be >= 0");
    const refs = sortByCreatedTimeDesc(
      filterByKind(
        await this.collectMessageRefs(baseMessageQuery(), "createdTime desc"),
        options.kind,
      ),
    );
    const toDelete = refs.slice(options.keep);
    return this.deleteMessageRefs(
      toDelete,
      options.dryRun,
      refs.length - toDelete.length,
    );
  }

  async pruneBefore(
    options: { before: Date } & PruneOptions,
  ): Promise<PruneResult> {
    const all = filterByKind(
      await this.collectMessageRefs(baseMessageQuery()),
      options.kind,
    );
    const toDelete = filterByKind(
      await this.collectMessageRefs(buildBeforeQuery(options.before)),
      options.kind,
    );
    return this.deleteMessageRefs(
      toDelete,
      options.dryRun,
      all.length - toDelete.length,
    );
  }

  private async collectMessageRefs(
    query: string,
    orderBy?: string,
  ): Promise<MessageRef[]> {
    const refs: MessageRef[] = [];
    let pageToken: string | undefined;
    do {
      const result = await this.client.listAppDataFiles(query, {
        pageToken,
        orderBy,
      });
      for (const file of result.files ?? []) refs.push(toMessageRef(file));
      pageToken = result.nextPageToken;
    } while (pageToken);
    return refs;
  }

  private async deleteMessageRefs(
    refs: MessageRef[],
    dryRun?: boolean,
    keptCount = 0,
  ): Promise<PruneResult> {
    if (dryRun) {
      return { deleted: refs, deletedCount: refs.length, keptCount };
    }
    for (const ref of refs) await this.client.deleteAppDataFile(ref.fileId);
    return { deleted: refs, deletedCount: refs.length, keptCount };
  }
}
