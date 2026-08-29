import { DRIVE_APPDATA_SCOPE } from "../constants.ts";
import { NotAuthenticatedError } from "../../errors/not-authenticated-error.ts";
import { GoogleSignInLoader } from "./gogle-sign-in-loader.ts";

interface StoredTokens {
  accessToken: string;
  expiresAt?: number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

const TOKEN_EXPIRY_SKEW_MS = 60_000;

export class GoogleOAuth {
  private accessToken: string | null = null;
  private expiresAt: number | null = null;
  private persistListenersInstalled = false;
  private tokenClient: google.accounts.oauth2.TokenClient | null = null;
  private tokenRequest: {
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;
  private acquireInFlight: Promise<void> | null = null;

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

  async ensureAccessToken(options?: { interactive?: boolean }): Promise<void> {
    if (this.hasValidAccessToken()) return;

    const interactive = options?.interactive ?? false;

    try {
      await this.acquireAccessToken({ interactive: false });
      if (this.hasValidAccessToken()) return;
    } catch {
      // fall through to interactive or fail
    }

    if (!interactive) throw new NotAuthenticatedError();

    await this.acquireAccessToken({ interactive: true });
    if (!this.hasValidAccessToken()) throw new NotAuthenticatedError();
  }

  installPersistListeners(): void {
    if (this.persistListenersInstalled) return;
    if (typeof window === "undefined" || typeof document === "undefined")
      return;
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

    try {
      await this.acquireAccessToken({ interactive: false });
      if (this.hasValidAccessToken()) return;
    } catch {
      if (!interactive) return;
    }

    if (!interactive) return;

    await this.acquireAccessToken({ interactive: true });
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
      if (parsed.expiresAt !== undefined) this.expiresAt = parsed.expiresAt;
    } catch {
      // ignore corrupt storage
    }
  }

  persistToLocalStorage(): void {
    if (typeof localStorage === "undefined") return;
    if (!this.accessToken) {
      this.removeFromLocalStorage();
      return;
    }

    const payload: StoredTokens = {
      accessToken: this.accessToken,
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
    this.expiresAt = null;
  }

  private applyTokenResponse(response: TokenResponse): void {
    if (!response.access_token) {
      throw new Error(
        response.error_description ??
          response.error ??
          "OAuth token response missing access_token",
      );
    }
    this.accessToken = response.access_token;
    if (response.expires_in !== undefined) {
      this.expiresAt = Date.now() + response.expires_in * 1000;
    }
  }

  private async ensureTokenClient(): Promise<google.accounts.oauth2.TokenClient> {
    if (this.tokenClient) return this.tokenClient;

    await GoogleSignInLoader.load();
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: DRIVE_APPDATA_SCOPE,
      callback: (response) => {
        const pending = this.tokenRequest;
        this.tokenRequest = null;
        if (!pending) return;

        if (response.error || !response.access_token) {
          pending.reject(
            new Error(
              response.error_description ?? response.error ?? "OAuth failed",
            ),
          );
          return;
        }

        try {
          this.applyTokenResponse(response);
          pending.resolve();
        } catch (error) {
          pending.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      },
    });
    return this.tokenClient;
  }

  private acquireAccessToken(options: { interactive: boolean }): Promise<void> {
    if (this.acquireInFlight) return this.acquireInFlight;

    this.acquireInFlight = this.requestAccessToken(options).finally(() => {
      this.acquireInFlight = null;
    });
    return this.acquireInFlight;
  }

  private async requestAccessToken(options: {
    interactive: boolean;
  }): Promise<void> {
    const client = await this.ensureTokenClient();

    return new Promise<void>((resolve, reject) => {
      this.tokenRequest = { resolve, reject };
      client.requestAccessToken(
        options.interactive ? undefined : { prompt: "" },
      );
    });
  }
}
