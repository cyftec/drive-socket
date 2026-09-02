import { NotAuthenticatedError } from "../../errors/not-authenticated-error.ts";

interface StoredTokens {
  accessToken: string;
  expiresAt: number;
}

export class GoogleOAuth {
  private static gsiScriptLoadPromise: Promise<void> | null = null;
  private accessToken: string | null = null;
  private expiresAt: number | null = null;
  private tokenClient: google.accounts.oauth2.TokenClient | null = null;
  private tokenRequest: {
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;
  private acquireInFlight: Promise<void> | null = null;

  constructor(
    private readonly googleApiClientId: string,
    private readonly tokenStorageKey: string,
    private readonly googleOAuthTokenScopes: string,
  ) {}

  async connect(): Promise<void> {
    await this.ensureUserIsLoggedIn();
  }

  private loadTokensFromStorage(): void {
    const raw = localStorage.getItem(this.tokenStorageKey);
    const parsed = JSON.parse(raw || "{}") as StoredTokens;
    if (!parsed.accessToken || !parsed.expiresAt) return;

    this.accessToken = parsed.accessToken;
    this.expiresAt = parsed.expiresAt;
  }

  private loadedTokensAreValid(): boolean {
    const tokenExpirySkewInMs = 60_000;
    return (
      this.accessToken !== null &&
      this.expiresAt !== null &&
      this.expiresAt > Date.now() + tokenExpirySkewInMs
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
    localStorage.setItem(this.tokenStorageKey, JSON.stringify(payload));
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
      await this.ensureGsiScriptLoaded();
      await new Promise<void>((resolve) => {
        google.accounts.oauth2.revoke(token, () => resolve());
      });
    }
    this.accessToken = null;
    this.expiresAt = null;
    localStorage.removeItem(this.tokenStorageKey);
  }

  private ensureGsiScriptLoaded(): Promise<void> {
    if (typeof google !== "undefined" && google.accounts?.oauth2) {
      return Promise.resolve();
    }
    if (!GoogleOAuth.gsiScriptLoadPromise) {
      const gsiClientUrl = "https://accounts.google.com/gsi/client";
      GoogleOAuth.gsiScriptLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = gsiClientUrl;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () =>
          reject(
            new Error(`Failed to load Google Sign-In script: ${gsiClientUrl}`),
          );
        document.head.appendChild(script);
      });
    }
    return GoogleOAuth.gsiScriptLoadPromise;
  }

  private async ensureTokenClient(): Promise<google.accounts.oauth2.TokenClient> {
    if (this.tokenClient) return this.tokenClient;

    await this.ensureGsiScriptLoaded();
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: this.googleApiClientId,
      scope: this.googleOAuthTokenScopes,
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
