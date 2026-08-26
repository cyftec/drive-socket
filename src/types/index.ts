export type MessageKind = 'json' | 'file';

export interface MessageRef {
  fileId: string;
  fileName: string;
  createdTime: string;
  mimeType: string;
  kind: MessageKind;
  size?: number;
}

export interface PushedMessageBase {
  fileId: string;
  fileName: string;
  createdTime: string;
  mimeType: string;
}

export interface PushedMessageJson<T = unknown> extends PushedMessageBase {
  kind: 'json';
  mimeType: 'application/json';
  payload: T;
}

export interface PushedMessageFile extends PushedMessageBase {
  kind: 'file';
  mimeType: string;
  payload: Blob;
}

export type PushedMessage<T = unknown> = PushedMessageJson<T> | PushedMessageFile;

export interface DriveSocketConfig {
  clientId: string;
  gisScriptUrl?: string;
  onTokenChange?: (token: string | null) => void;
}

export interface ListOptions {
  since?: Date;
  until?: Date;
  limit?: number;
  kind?: MessageKind;
}

export interface PruneOptions {
  dryRun?: boolean;
  kind?: MessageKind;
}

export interface PruneResult {
  deleted: MessageRef[];
  deletedCount: number;
  keptCount: number;
}

export interface DriveFileMetadata {
  id: string;
  name: string;
  createdTime: string;
  mimeType: string;
  size?: string;
}
