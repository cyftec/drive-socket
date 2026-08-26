import type {
  DriveFileMetadata,
  PushedMessage,
  PushedMessageFile,
  PushedMessageJson,
} from "../../types/index.ts";
import { toMessageRef } from "./to-message-ref.ts";

export async function toPushedMessage<T>(
  file: DriveFileMetadata,
  body: Blob,
): Promise<PushedMessage<T>> {
  const ref = toMessageRef(file);
  if (ref.kind === "json") {
    const text = await body.text();
    const payload = JSON.parse(text) as T;
    const message: PushedMessageJson<T> = {
      ...ref,
      kind: "json",
      mimeType: "application/json",
      payload,
    };
    return message;
  }
  const message: PushedMessageFile = { ...ref, kind: "file", payload: body };
  return message;
}
