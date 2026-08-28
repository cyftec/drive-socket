import {
  DRIVE_APPDATA_SCOPE,
  GOOGLE_TOKEN_URL,
} from "../constants.ts";
import { GoogleSignInLoader } from "./gogle-sign-in-loader.ts";

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt?: number;
}

interface TokenEndpointResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}

const TOKEN_EXPIRY_SKEW_MS = 60_000;

export class GoogleOAuth {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private expiresAt: number | null = null;
  private persistListenersInstalled = false;

  constructor(
    private readonly clientId: string,
    private readonly storageKey: string,
  ) {}

  hasValidAccessToken(): boolean {
    if (!this.accessToken) return false;
    if (this.expiresAt === null) return true;
    return this.expiresAt > Date.now() + TOKEN_EXPIRY_SKEW_MS;
  }

  getAccessToken(): string | null {
    return this.hasValidAccessToken() ? this.accessToken : null;
  }

  installPersistListeners(): void {
    if (this.persistListenersInstalled) return;
    if (typeof window === "undefined" || typeof document === "undefined") return;
    this.persistListenersInstalled = true;

    const persist = () => this.persistToLocalStorage();

    window.addEventListener("pagehide", persist);
    window.addEventListener("beforeunload", persist);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") persist();
    });
  }

  async connect(options?: { interactive?: boolean }): Promise<void> {
    const interactive = options?.interactive ?? true;

    this.loadFromLocalStorage();

    if (this.hasValidAccessToken()) return;

    if (this.refreshToken) {
      try {
        await this.refreshAccessToken();
        return;
      } catch {
        if (!interactive) return;
      }
    }

    if (!interactive) return;

    await this.interactiveConnect();
  }

  async disconnect(): Promise<void> {
    const token = this.accessToken;
    if (token) {
      await GoogleSignInLoader.load();
      await new Promise<void>((resolve) => {
        google.accounts.oauth2.revoke(token, () => resolve());
      });
    }
    this.clearTokens();
    this.removeFromLocalStorage();
  }

  private loadFromLocalStorage(): void {
    if (typeof localStorage === "undefined") return;

    const raw = localStorage.getItem(this.storageKey);
    localStorage.removeItem(this.storageKey);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as StoredTokens;
      if (parsed.accessToken) this.accessToken = parsed.accessToken;
      if (parsed.refreshToken) this.refreshToken = parsed.refreshToken;
      if (parsed.expiresAt !== undefined) this.expiresAt = parsed.expiresAt;
    } catch {
      // ignore corrupt storage
    }
  }

  persistToLocalStorage(): void {
    if (typeof localStorage === "undefined") return;
    if (!this.accessToken && !this.refreshToken) {
      this.removeFromLocalStorage();
      return;
    }

    const payload: StoredTokens = {
      accessToken: this.accessToken ?? "",
      refreshToken: this.refreshToken ?? "",
      expiresAt: this.expiresAt ?? undefined,
    };
    localStorage.setItem(this.storageKey, JSON.stringify(payload));
  }

  private removeFromLocalStorage(): void {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(this.storageKey);
  }

  private clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = null;
  }

  private applyTokenResponse(response: TokenEndpointResponse): void {
    if (!response.access_token) {
      throw new Error(response.error ?? "OAuth token response missing access_token");
    }
    this.accessToken = response.access_token;
    if (response.refresh_token) this.refreshToken = response.refresh_token;
    if (response.expires_in !== undefined) {
      this.expiresAt = Date.now() + response.expires_in * 1000;
    }
  }

  async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error("No refresh token available");
    }

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        refresh_token: this.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    const data = (await response.json()) as TokenEndpointResponse;
    if (!response.ok) {
      throw new Error(data.error ?? "Token refresh failed");
    }
    this.applyTokenResponse(data);
  }

  private async exchangeAuthorizationCode(code: string): Promise<void> {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        redirect_uri: "postmessage",
        grant_type: "authorization_code",
      }),
    });

    const data = (await response.json()) as TokenEndpointResponse;
    if (!response.ok) {
      throw new Error(data.error ?? "Authorization code exchange failed");
    }
    this.applyTokenResponse(data);
  }

  private async interactiveConnect(): Promise<void> {
    await GoogleSignInLoader.load();
    await new Promise<void>((resolve, reject) => {
      const client = google.accounts.oauth2.initCodeClient({
        client_id: this.clientId,
        scope: DRIVE_APPDATA_SCOPE,
        ux_mode: "popup",
        access_type: "offline",
        prompt: "consent",
        callback: async (response) => {
          if (response.error || !response.code) {
            reject(new Error(response.error ?? "OAuth failed"));
            return;
          }
          try {
            await this.exchangeAuthorizationCode(response.code);
            resolve();
          } catch (error) {
            reject(error);
          }
        },
      });
      client.requestCode();
    });
  }
}
