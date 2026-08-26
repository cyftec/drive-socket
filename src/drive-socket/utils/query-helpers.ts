import type { ReceiveOptions } from "../../types";

export function baseMessageQuery(): string {
  return "name contains 'msg-' and trashed=false";
}

export function buildBeforeQuery(before: Date): string {
  return `${baseMessageQuery()} and createdTime < '${before.toISOString()}'`;
}

export function buildReceiveQuery(
  options?: Pick<ReceiveOptions, "since" | "until">,
): string {
  const query = baseMessageQuery();

  return options?.since
    ? `${query} and createdTime >= '${options.since.toISOString()}'`
    : options?.until
      ? `${query} and createdTime <= '${options.until.toISOString()}'`
      : query;
}
