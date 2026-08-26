import type { DriveClient } from '../drive/drive-client.ts';
import { baseMessageQuery } from '../messages/query/base-message-query.ts';
import { filterByKind } from '../messages/parser/filter-by-kind.ts';
import { sortByCreatedTimeDesc } from '../messages/parser/sort-by-created-time-desc.ts';
import { collectMessageRefs } from './collect-message-refs.ts';
import { deleteMessageRefs } from './delete-message-refs.ts';
import type { PruneOptions, PruneResult } from '../types/index.ts';

export async function pruneByCount(
  client: DriveClient,
  keep: number,
  options?: PruneOptions,
): Promise<PruneResult> {
  if (keep < 0) throw new RangeError('keep must be >= 0');
  const refs = sortByCreatedTimeDesc(
    filterByKind(await collectMessageRefs(client, baseMessageQuery(), 'createdTime desc'), options?.kind),
  );
  const toDelete = refs.slice(keep);
  const result = await deleteMessageRefs(client, toDelete, options?.dryRun);
  return { ...result, keptCount: refs.length - toDelete.length };
}
