import {
  getOAuthSingleton,
  type GoogleOAuth,
} from "../../src/google/oauth.ts";

export type { GoogleOAuth };

export const CLIENT_ID = "client-id";
export const DRIVE_APPDATA_SCOPE =
  "https://www.googleapis.com/auth/drive.appdata";
export const TOKEN_KEY = `drive-socket:tokens:${CLIENT_ID}:${DRIVE_APPDATA_SCOPE}`;

let oauthSingleton: GoogleOAuth | null = null;

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
  const internal = oauth as GoogleOAuth & {
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
