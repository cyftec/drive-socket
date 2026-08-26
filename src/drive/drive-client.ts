import { NotAuthenticatedError } from '../errors/not-authenticated-error.ts';
import { parseDriveError } from './parse-drive-error.ts';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export class DriveClient {
  constructor(private readonly getToken: () => string | null) {}

  async request(path: string, init?: RequestInit, base = DRIVE_API): Promise<Response> {
    const token = this.getToken();
    if (!token) throw new NotAuthenticatedError();
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
    });
    if (!response.ok) throw await parseDriveError(response);
    return response;
  }

  get uploadBase(): string {
    return DRIVE_UPLOAD;
  }
}
