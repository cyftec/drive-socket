export function appendSince(query: string, since: Date): string {
  return `${query} and createdTime >= '${since.toISOString()}'`;
}
