import type { FileMetadata } from "../../src/types/index.ts";

type DefaultFileFields = "id" | "name" | "createdTime" | "mimeType" | "size";

export function sampleMetadata(
  overrides: Partial<FileMetadata<DefaultFileFields>> = {},
): FileMetadata<DefaultFileFields> {
  return {
    id: "file-1",
    name: "msg-20260101T000000Z-abcdef12.json",
    createdTime: "2026-01-01T00:00:00.000Z",
    mimeType: "application/json",
    size: "12",
    ...overrides,
  };
}
