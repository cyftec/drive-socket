export function appendBefore(query: string, before: Date): string {
  return `${query} and createdTime < '${before.toISOString()}'`;
}
