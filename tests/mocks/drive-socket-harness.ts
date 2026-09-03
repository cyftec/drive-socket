import type { DriveSocketConfig } from "../../src/drive-socket.ts";

export const DEFAULT_ROOT_PATH = "messages";
export const ROOT_FOLDER_ID = "folder-1";

export function defaultDriveSocketConfig(
  overrides: Partial<DriveSocketConfig> = {},
): DriveSocketConfig {
  return {
    clientType: "single-tenant",
    rootPath: DEFAULT_ROOT_PATH,
    pollIntervalInMs: 100,
    maxFiles: 10,
    ...overrides,
  };
}
