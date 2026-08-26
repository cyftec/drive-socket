import { DRIVE_APPDATA_SCOPE } from "./constants.ts";
import { GoogleSignInLoader } from "./gogle-sign-in-loader.ts";

export class GoogleOAuth {
  private token: string | null = null;
  private readonly clientId: string;
  private readonly googleSignInScriptUrl?: string;
  private readonly onTokenChange?: (token: string | null) => void;

  constructor(
    clientId: string,
    options?: {
      googleSignInScriptUrl?: string;
      onTokenChange?: (token: string | null) => void;
    },
  ) {
    this.clientId = clientId;
    this.googleSignInScriptUrl = options?.googleSignInScriptUrl;
    this.onTokenChange = options?.onTokenChange;
  }

  getAccessToken(): string | null {
    return this.token;
  }

  async connect(): Promise<void> {
    await GoogleSignInLoader.load(this.googleSignInScriptUrl);
    await new Promise<void>((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: DRIVE_APPDATA_SCOPE,
        callback: (response: google.accounts.oauth2.TokenResponse) => {
          if (response.error || !response.access_token) {
            reject(new Error(response.error ?? "OAuth failed"));
            return;
          }
          if (
            !google.accounts.oauth2.hasGrantedAllScopes(
              response,
              DRIVE_APPDATA_SCOPE,
            )
          ) {
            reject(new Error("drive.appdata scope not granted"));
            return;
          }
          this.setToken(response.access_token);
          resolve();
        },
      });
      client.requestAccessToken();
    });
  }

  async disconnect(): Promise<void> {
    const token = this.token;
    if (!token) return;
    await new Promise<void>((resolve) => {
      google.accounts.oauth2.revoke(token, () => {
        this.setToken(null);
        resolve();
      });
    });
  }

  private setToken(token: string | null): void {
    this.token = token;
    this.onTokenChange?.(token);
  }
}
