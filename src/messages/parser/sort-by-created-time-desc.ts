import type { FileMessageMetadata } from "../../types/index.ts";

export function sortByCreatedTimeDesc(
  files: FileMessageMetadata[],
): FileMessageMetadata[] {
  return [...files].sort((a, b) => {
    const timeDiff = b.createdTime.localeCompare(a.createdTime);
    return timeDiff !== 0 ? timeDiff : a.id.localeCompare(b.id);
  });
}
