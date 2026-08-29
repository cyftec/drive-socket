import { DRIVE_APPDATA_SCOPE } from "./utils";
import { NotAuthenticatedError } from "../errors/not-authenticated-error.ts";
import { loadGoogleSignIn } from "./sign-in-loader.ts";

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
  ) {
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      window.addEventListener("pagehide", () => this.onTabHidden());
      window.addEventListener("beforeunload", () => this.onTabHidden());
      window.addEventListener("focus", () => this.onTabVisible());
      window.addEventListener("pageshow", () => {
        if (document.visibilityState === "visible") this.onTabVisible();
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          this.onTabHidden();
        } else {
          this.onTabVisible();
        }
      });

      if (document.visibilityState === "visible") {
        this.onTabVisible();
      }
    }
  }

  private hasValidAccessToken(): boolean {
    if (!this.accessToken || this.expiresAt === null) return false;
    return this.expiresAt > Date.now() + TOKEN_EXPIRY_SKEW_MS;
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

  async authorizedFetch(url: string, init?: RequestInit): Promise<Response> {
    if (!this.hasValidAccessToken()) throw new NotAuthenticatedError();
    return fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...init?.headers,
      },
    });
  }

  async connect(options?: { interactive?: boolean }): Promise<void> {
    const interactive = options?.interactive ?? true;

    this.loadFromLocalStorage();
    if (this.hasValidAccessToken()) return;

    if (interactive) {
      await this.ensureAccessToken({ interactive: true });
      return;
    }

    try {
      await this.ensureAccessToken({ interactive: false });
    } catch {
      // silent connect stops when tokens cannot be restored
    }
  }

  async disconnect(): Promise<void> {
    const token = this.accessToken;
    if (token) {
      await loadGoogleSignIn();
      await new Promise<void>((resolve) => {
        google.accounts.oauth2.revoke(token, () => resolve());
      });
    }
    this.clearTokens();
    this.removeFromLocalStorage();
  }

  private onTabVisible(): void {
    if (!this.hasValidAccessToken()) {
      this.loadFromLocalStorage();
    }
    this.removeFromLocalStorage();
  }

  private onTabHidden(): void {
    this.persistToLocalStorage();
  }

  private loadFromLocalStorage(): void {
    if (typeof localStorage === "undefined") return;

    const raw = localStorage.getItem(this.storageKey);
    localStorage.removeItem(this.storageKey);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as StoredTokens;
      if (parsed.accessToken && parsed.expiresAt !== undefined) {
        this.accessToken = parsed.accessToken;
        this.expiresAt = parsed.expiresAt;
      }
    } catch {
      // ignore corrupt storage
    }
  }

  private persistToLocalStorage(): void {
    if (typeof localStorage === "undefined") return;
    if (!this.accessToken || this.expiresAt === null) {
      this.removeFromLocalStorage();
      return;
    }

    const payload: StoredTokens = {
      accessToken: this.accessToken,
      expiresAt: this.expiresAt,
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

  private applyTokenResponse(
    response: google.accounts.oauth2.TokenResponse,
  ): void {
    if (!response.access_token) {
      throw new Error(
        response.error_description ??
          response.error ??
          "OAuth token response missing access_token",
      );
    }
    this.accessToken = response.access_token;
    this.expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000;
    this.removeFromLocalStorage();
  }

  private async ensureTokenClient(): Promise<google.accounts.oauth2.TokenClient> {
    if (this.tokenClient) return this.tokenClient;

    await loadGoogleSignIn();
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
