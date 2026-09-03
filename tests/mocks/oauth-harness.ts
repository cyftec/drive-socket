import {
  getOAuthSingleton,
  type GoogleOAuth,
} from "../../src/google/oauth.ts";

export type { GoogleOAuth };

export const CLIENT_ID = "client-id";
export const DRIVE_APPDATA_SCOPE =
  "https://www.googleapis.com/auth/drive.appdata";
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const TOKEN_KEY = `drive-socket:tokens:${CLIENT_ID}:${DRIVE_APPDATA_SCOPE}`;

let oauthSingleton: GoogleOAuth | null = null;

export function createMockOAuth(scopes: string): GoogleOAuth {
  return {
    getConfiguredScopes: () => scopes,
    authenticate: async () => {},
    authorizedFetch: (url, init) => fetch(url, init),
  } as GoogleOAuth;
}

export function getTestOAuth(): GoogleOAuth {
  if (!oauthSingleton) {
    oauthSingleton = getOAuthSingleton({
      googleApiClientId: CLIENT_ID,
      googleOAuthTokenScopes: DRIVE_APPDATA_SCOPE,
    });
    return oauthSingleton;
  }

  resetTestOAuthState(oauthSingleton);
  return oauthSingleton;
}

export function resetTestOAuthState(oauth: GoogleOAuth): void {
  const internal = oauth as unknown as {
    accessToken: string | null;
    expiresAt: number | null;
    tokenClient: unknown;
    tokenRequest: unknown;
    acquireInFlight: unknown;
  };

  internal.accessToken = null;
  internal.expiresAt = null;
  internal.tokenClient = null;
  internal.tokenRequest = null;
  internal.acquireInFlight = null;
}

export function installLocalStorageMock(): { storage: Map<string, string> } {
  const storage = new Map<string, string>();
  const mock = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
    key: (_index: number) => null,
    length: 0,
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: mock,
    configurable: true,
  });
  return { storage };
}
