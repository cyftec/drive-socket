import { GoogleOAuth } from "../auth/google-oauth.ts";
import { DriveClient } from "../drive/drive-client.ts";
import { InvalidMimeError } from "../errors/invalid-mime-error.ts";
import { MessageExistsError } from "../errors/message-exists-error.ts";
import { toBlob } from "../messages/blob/to-blob.ts";
import { generateMessageFileName } from "../messages/filename/generate-message-file-name.ts";
import { isValidMimeType } from "../messages/mime/is-valid-mime-type.ts";
import { mimeToExtension } from "../messages/mime/mime-to-extension.ts";
import { sortByCreatedTimeDesc } from "../messages/parser/sort-by-created-time-desc.ts";
import { toMessageRef } from "../messages/parser/to-message-ref.ts";
import { toPushedMessage } from "../messages/parser/to-pushed-message.ts";
import {
  baseMessageQuery,
  buildBeforeQuery,
  buildReceiveQuery,
} from "../messages/query-helpers.ts";
import type {
  DriveSocketConfig,
  MessageRef,
  PruneOptions,
  PruneResult,
  PushedMessage,
  ReceiveOptions,
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

  async push(
    data: Blob | ArrayBuffer | Uint8Array,
    options: { mimeType: string },
  ): Promise<PushedMessage> {
    const { mimeType } = options;
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
    return toPushedMessage(file, content);
  }

  async receive(
    options: ReceiveOptions & { as: "metadata" },
  ): Promise<MessageRef[]>;
  async receive(
    options: ReceiveOptions & { as: "payload" },
  ): Promise<PushedMessage[]>;
  async receive(
    options: ReceiveOptions,
  ): Promise<MessageRef[] | PushedMessage[]> {
    const refs = sortByCreatedTimeDesc(
      await this.collectMessageRefs(
        buildReceiveQuery(options),
        "createdTime desc",
      ),
    );
    const selected = options.limit ? refs.slice(0, options.limit) : refs;

    if (options.as === "metadata") return selected;

    const messages: PushedMessage[] = [];
    for (const ref of selected) {
      const payload = await this.client.downloadAppDataFile(ref.fileId);
      messages.push({ ...ref, payload });
    }
    return messages;
  }

  async getById(fileId: string): Promise<PushedMessage> {
    const response = await this.client.request(
      `/files/${fileId}?fields=id,name,createdTime,mimeType,size`,
    );
    const file = await response.json();
    const body = await this.client.downloadAppDataFile(fileId);
    return toPushedMessage(file, body);
  }

  async pruneByCount(
    options: { keep: number } & PruneOptions,
  ): Promise<PruneResult> {
    if (options.keep < 0) throw new RangeError("keep must be >= 0");
    const refs = sortByCreatedTimeDesc(
      await this.collectMessageRefs(baseMessageQuery(), "createdTime desc"),
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
    const all = await this.collectMessageRefs(baseMessageQuery());
    const toDelete = await this.collectMessageRefs(
      buildBeforeQuery(options.before),
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
