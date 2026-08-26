import type { DriveClient } from '../drive/drive-client.ts';
import { deleteAppDataFile } from '../drive/delete-app-data-file.ts';
import type { MessageRef, PruneResult } from '../types/index.ts';

export async function deleteMessageRefs(
  client: DriveClient,
  refs: MessageRef[],
  dryRun?: boolean,
): Promise<PruneResult> {
  if (dryRun) {
    return { deleted: refs, deletedCount: refs.length, keptCount: 0 };
  }
  for (const ref of refs) await deleteAppDataFile(client, ref.fileId);
  return { deleted: refs, deletedCount: refs.length, keptCount: 0 };
}
