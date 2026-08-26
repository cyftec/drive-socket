import type { ListOptions } from "../types";

export function baseMessageQuery(): string {
  return "name contains 'msg-' and trashed=false";
}

export function buildBeforeQuery(before: Date): string {
  return `${baseMessageQuery()} and createdTime < '${before.toISOString()}'`;
}

export function buildListQuery(options?: ListOptions): string {
  const query = baseMessageQuery();

  return options?.since
    ? `${query} and createdTime >= '${options.since.toISOString()}'`
    : options?.until
      ? `${query} and createdTime <= '${options.until.toISOString()}'`
      : query;
}
