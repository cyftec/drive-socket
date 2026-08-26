export function appendUntil(query: string, until: Date): string {
  return `${query} and createdTime <= '${until.toISOString()}'`;
}
