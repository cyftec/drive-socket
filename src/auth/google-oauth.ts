import { DRIVE_APPDATA_SCOPE } from "./constants.ts";
import { GoogleSignInLoader } from "./gogle-sign-in-loader.ts";

export class GoogleOAuth {
  private token: string | null = null;

  constructor(private readonly clientId: string) {}

  getAccessToken(): string | null {
    return this.token;
  }

  async connect(): Promise<void> {
    await GoogleSignInLoader.load();
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
          this.token = response.access_token;
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
        this.token = null;
        resolve();
      });
    });
  }
}
