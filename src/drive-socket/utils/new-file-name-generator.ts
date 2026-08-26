function randomSuffix(length = 8): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, length);
}

export function generateMessageFileName(extension: string): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `msg-${timestamp}-${randomSuffix()}.${extension}`;
}
