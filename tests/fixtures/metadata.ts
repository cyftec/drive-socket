import type { FileMessageMetadata } from "../../src/types/index.ts";

export function sampleMetadata(
  overrides: Partial<FileMessageMetadata> = {},
): FileMessageMetadata {
  return {
    id: "file-1",
    name: "msg-20260101T000000Z-abcdef12.json",
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: "application/json",
    size: "12",
    ...overrides,
  };
}
