import type { ListOptions } from '../../types/index.ts';
import { appendSince } from './append-since.ts';
import { appendUntil } from './append-until.ts';
import { baseMessageQuery } from './base-message-query.ts';

export function buildListQuery(options?: ListOptions): string {
  let query = baseMessageQuery();
  if (options?.since) query = appendSince(query, options.since);
  if (options?.until) query = appendUntil(query, options.until);
  return query;
}
