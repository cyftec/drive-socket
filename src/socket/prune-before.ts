import type { DriveClient } from '../drive/drive-client.ts';
import { baseMessageQuery } from '../messages/query/base-message-query.ts';
import { buildBeforeQuery } from '../messages/query/build-before-query.ts';
import { filterByKind } from '../messages/parser/filter-by-kind.ts';
import { collectMessageRefs } from './collect-message-refs.ts';
import { deleteMessageRefs } from './delete-message-refs.ts';
import type { PruneOptions, PruneResult } from '../types/index.ts';

export async function pruneBefore(
  client: DriveClient,
  before: Date,
  options?: PruneOptions,
): Promise<PruneResult> {
  const all = filterByKind(
    await collectMessageRefs(client, baseMessageQuery()),
    options?.kind,
  );
  const toDelete = filterByKind(
    await collectMessageRefs(client, buildBeforeQuery(before)),
    options?.kind,
  );
  const result = await deleteMessageRefs(client, toDelete, options?.dryRun);
  return { ...result, keptCount: all.length - toDelete.length };
}
