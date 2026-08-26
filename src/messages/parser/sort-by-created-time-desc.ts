import type { MessageRef } from '../../types/index.ts';

export function sortByCreatedTimeDesc(refs: MessageRef[]): MessageRef[] {
  return [...refs].sort((a, b) => {
    const timeDiff = b.createdTime.localeCompare(a.createdTime);
    return timeDiff !== 0 ? timeDiff : a.fileId.localeCompare(b.fileId);
  });
}
