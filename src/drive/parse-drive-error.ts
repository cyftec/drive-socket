import { DriveApiError } from '../errors/drive-api-error.ts';

export async function parseDriveError(response: Response): Promise<DriveApiError> {
  let message = `Drive API error: ${response.status}`;
  let reason = 'unknown';
  try {
    const body = (await response.json()) as {
      error?: { message?: string; errors?: Array<{ reason?: string }> };
    };
    message = body.error?.message ?? message;
    reason = body.error?.errors?.[0]?.reason ?? reason;
  } catch {
    // keep defaults
  }
  return new DriveApiError(message, response.status, reason);
}
