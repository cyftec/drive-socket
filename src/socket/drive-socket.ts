import { GoogleOAuth } from "../auth/google-oauth.ts";
import { DriveClient } from "../drive/drive-client.ts";
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
import { getLatestMessage } from "./get-latest-message.ts";
import { getMessageById } from "./get-message-by-id.ts";
import { listMessages } from "./list-messages.ts";
import { pruneBefore } from "./prune-before.ts";
import { pruneByCount } from "./prune-by-count.ts";
import { pushFile } from "./push-file.ts";
import { pushJson } from "./push-json.ts";

export class DriveSocket {
  private readonly oauth: GoogleOAuth;
  private readonly client: DriveClient;

  constructor(config: DriveSocketConfig) {
    this.oauth = new GoogleOAuth(config.clientId, {
      googleSignInScriptUrl: config.googleSignInScriptUrl,
      onTokenChange: config.onTokenChange,
    });
    this.client = new DriveClient(() => this.oauth.getAccessToken());
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

  pushJson<T>(payload: T): Promise<PushedMessageJson<T>> {
    return pushJson(this.client, payload);
  }

  pushFile(
    data: Blob | ArrayBuffer | Uint8Array,
    options: { mimeType: string },
  ): Promise<PushedMessageFile> {
    return pushFile(this.client, data, options.mimeType);
  }

  getLatest<T = unknown>(): Promise<PushedMessage<T> | null> {
    return getLatestMessage<T>(this.client);
  }

  list(options?: ListOptions): Promise<MessageRef[]> {
    return listMessages(this.client, options);
  }

  getById<T = unknown>(fileId: string): Promise<PushedMessage<T>> {
    return getMessageById<T>(this.client, fileId);
  }

  pruneByCount(options: { keep: number } & PruneOptions): Promise<PruneResult> {
    return pruneByCount(this.client, options.keep, options);
  }

  pruneBefore(options: { before: Date } & PruneOptions): Promise<PruneResult> {
    return pruneBefore(this.client, options.before, options);
  }
}
