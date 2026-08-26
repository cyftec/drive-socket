import type { DriveClient } from '../drive/drive-client.ts';
import { buildListQuery } from '../messages/query/build-list-query.ts';
import { filterByKind } from '../messages/parser/filter-by-kind.ts';
import { sortByCreatedTimeDesc } from '../messages/parser/sort-by-created-time-desc.ts';
import { collectMessageRefs } from './collect-message-refs.ts';
import type { ListOptions, MessageRef } from '../types/index.ts';

export async function listMessages(
  client: DriveClient,
  options?: ListOptions,
): Promise<MessageRef[]> {
  const query = buildListQuery(options);
  const refs = await collectMessageRefs(client, query, 'createdTime desc');
  const filtered = filterByKind(refs, options?.kind);
  const sorted = sortByCreatedTimeDesc(filtered);
  return options?.limit ? sorted.slice(0, options.limit) : sorted;
}
