import { NotAuthenticatedError } from "../errors/not-authenticated-error.ts";
import { loadGsiScript } from "./gsi-script-loader.ts";

interface StoredTokens {
  accessToken: string;
  expiresAt: number;
}

const TOKEN_EXPIRY_SKEW_MS = 60_000;

export class GoogleOAuth {
  private accessToken: string | null = null;
  private expiresAt: number | null = null;
  private tokenClient: google.accounts.oauth2.TokenClient | null = null;
  private tokenRequest: {
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;
  private acquireInFlight: Promise<void> | null = null;

  constructor(
    private readonly clientId: string,
    private readonly storageKey: string,
    private readonly tokenScopes: string,
  ) {}

  async connect(): Promise<void> {
    await this.ensureUserIsLoggedIn();
  }

  private loadTokensFromStorage(): void {
    const raw = localStorage.getItem(this.storageKey);
    const parsed = JSON.parse(raw || "{}") as StoredTokens;
    if (!parsed.accessToken || !parsed.expiresAt) return;

    this.accessToken = parsed.accessToken;
    this.expiresAt = parsed.expiresAt;
  }

  private loadedTokensAreValid(): boolean {
    return (
      this.accessToken !== null &&
      this.expiresAt !== null &&
      this.expiresAt > Date.now() + TOKEN_EXPIRY_SKEW_MS
    );
  }

  private updateTokensInStorage(): void {
    if (!this.accessToken || this.expiresAt === null) {
      throw new Error("Error while saving tokens to local storage");
    }

    const payload: StoredTokens = {
      accessToken: this.accessToken,
      expiresAt: this.expiresAt,
    };
    localStorage.setItem(this.storageKey, JSON.stringify(payload));
  }

  async ensureUserIsLoggedIn(): Promise<void> {
    if (this.loadedTokensAreValid()) return;
    this.loadTokensFromStorage();

    if (!this.loadedTokensAreValid()) {
      try {
        await this.acquireAccessToken({ prompt: "none" });
        if (this.loadedTokensAreValid()) return;
      } catch {
        // fall through to interactive sign-in
      }

      try {
        await this.acquireAccessToken({ prompt: "login" });
      } catch {
        // login failed or was dismissed
      }

      if (!this.loadedTokensAreValid()) throw new NotAuthenticatedError();
      this.updateTokensInStorage();
    }
  }

  async authorizedFetch(url: string, init?: RequestInit): Promise<Response> {
    await this.ensureUserIsLoggedIn();
    return fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...init?.headers,
      },
    });
  }

  async disconnect(): Promise<void> {
    const token = this.accessToken;
    if (token) {
      await loadGsiScript();
      await new Promise<void>((resolve) => {
        google.accounts.oauth2.revoke(token, () => resolve());
      });
    }
    this.accessToken = null;
    this.expiresAt = null;
    localStorage.removeItem(this.storageKey);
  }

  private async ensureTokenClient(): Promise<google.accounts.oauth2.TokenClient> {
    if (this.tokenClient) return this.tokenClient;

    await loadGsiScript();
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: this.tokenScopes,
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
          this.accessToken = response.access_token;
          this.expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000;
          this.updateTokensInStorage();
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

  private acquireAccessToken(options: {
    prompt: "none" | "login";
  }): Promise<void> {
    if (this.acquireInFlight) return this.acquireInFlight;

    this.acquireInFlight = this.requestAccessToken(options).finally(() => {
      this.acquireInFlight = null;
    });
    return this.acquireInFlight;
  }

  private async requestAccessToken(options: {
    prompt: "none" | "login";
  }): Promise<void> {
    const client = await this.ensureTokenClient();

    return new Promise<void>((resolve, reject) => {
      this.tokenRequest = { resolve, reject };
      client.requestAccessToken(
        options.prompt === "none" ? { prompt: "none" } : undefined,
      );
    });
  }
}
