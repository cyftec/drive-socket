import { appendBefore } from './append-before.ts';
import { baseMessageQuery } from './base-message-query.ts';

export function buildBeforeQuery(before: Date): string {
  return appendBefore(baseMessageQuery(), before);
}
