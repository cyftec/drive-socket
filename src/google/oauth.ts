import { NotAuthenticatedError } from "../errors/not-authenticated-error.ts";

interface StoredTokens {
  accessToken: string;
  expiresAt: number;
}

export interface GoogleOAuthConfig {
  googleApiClientId: string;
  googleOAuthTokenScopes: string;
}

export type GoogleOAuth = ReturnType<typeof getOAuthSingleton>;

export const getOAuthSingleton = (function () {
  class OAuth {
    private readonly googleApiClientId: string;
    private readonly tokenStorageKey: string;
    private readonly googleOAuthTokenScopes: string;
    private static gsiScriptLoadPromise: Promise<void> | null = null;
    private accessToken: string | null = null;
    private expiresAt: number | null = null;
    private tokenClient: google.accounts.oauth2.TokenClient | null = null;
    private tokenRequest: {
      resolve: () => void;
      reject: (error: Error) => void;
    } | null = null;
    private acquireInFlight: Promise<void> | null = null;

    constructor(config: GoogleOAuthConfig) {
      this.googleApiClientId = config.googleApiClientId;
      this.tokenStorageKey = `drive-socket:tokens:${config.googleApiClientId}:${config.googleOAuthTokenScopes}`;
      this.googleOAuthTokenScopes = config.googleOAuthTokenScopes;
    }

    // handy method to ensure logged-in state in advance, otherwise
    // logged-in state is anyways ensured in every this.authorizedFetch call
    async authenticate(): Promise<void> {
      await this.ensureUserIsLoggedIn();
    }

    async authorizedFetch(url: string, init?: RequestInit): Promise<Response> {
      await this.ensureUserIsLoggedIn();
      let response = await this.fetchWithAccessToken(url, init);

      if (response.status === 401 || response.status === 403) {
        this.invalidateTokens();
        await this.ensureUserIsLoggedIn();
        response = await this.fetchWithAccessToken(url, init);
      }

      return response;
    }

    private fetchWithAccessToken(
      url: string,
      init?: RequestInit,
    ): Promise<Response> {
      return fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          ...init?.headers,
        },
      });
    }

    private invalidateTokens(): void {
      this.accessToken = null;
      this.expiresAt = null;
      localStorage.removeItem(this.tokenStorageKey);
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

    private async ensureUserIsLoggedIn(): Promise<void> {
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

    private ensureGsiScriptLoaded(): Promise<void> {
      if (typeof google !== "undefined" && google.accounts?.oauth2) {
        return Promise.resolve();
      }

      if (!OAuth.gsiScriptLoadPromise) {
        OAuth.gsiScriptLoadPromise = OAuth.loadGsiScript().catch((error) => {
          OAuth.gsiScriptLoadPromise = null;
          throw error;
        });
      }

      return OAuth.gsiScriptLoadPromise;
    }

    private static loadGsiScript(): Promise<void> {
      const gsiClientUrl = "https://accounts.google.com/gsi/client";
      const existingScript = document.querySelector<HTMLScriptElement>(
        `script[src="${gsiClientUrl}"]`,
      );

      if (existingScript) {
        return OAuth.waitForGsiScript(existingScript);
      }

      const script = document.createElement("script");
      script.src = gsiClientUrl;
      script.async = true;
      document.head.appendChild(script);
      return OAuth.waitForGsiScript(script);
    }

    private static waitForGsiScript(script: HTMLScriptElement): Promise<void> {
      if (typeof google !== "undefined" && google.accounts?.oauth2) {
        return Promise.resolve();
      }

      return new Promise((resolve, reject) => {
        const cleanup = () => {
          script.removeEventListener("load", handleLoad);
          script.removeEventListener("error", handleError);
        };

        const finish = () => {
          cleanup();
          if (typeof google !== "undefined" && google.accounts?.oauth2) {
            resolve();
            return;
          }
          reject(
            new Error(
              "Google Sign-In script loaded but GIS OAuth is unavailable",
            ),
          );
        };

        const handleLoad = () => finish();
        const handleError = () => {
          cleanup();
          reject(
            new Error(
              "Failed to load Google Sign-In script: https://accounts.google.com/gsi/client",
            ),
          );
        };

        script.addEventListener("load", handleLoad);
        script.addEventListener("error", handleError);

        queueMicrotask(() => {
          if (typeof google !== "undefined" && google.accounts?.oauth2) {
            finish();
          }
        });
      });
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

  let oauthSingleton: OAuth;

  return function (config: GoogleOAuthConfig) {
    if (oauthSingleton)
      throw new Error(
        `Tried to instantiate a new oauth instance. One oauth singleton per html page is sufficient.`,
      );
    oauthSingleton = new OAuth(config);
    return oauthSingleton;
  };
})();
