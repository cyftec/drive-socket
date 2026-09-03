type TokenClientConfig = {
  client_id: string;
  scope: string;
  callback: (response: {
    access_token?: string;
    expires_in?: number;
    error?: string;
  }) => void;
};

type TokenRequestConfig = {
  prompt?: string;
};

export function installGoogleOAuthMock(options?: {
  onTokenInit?: (config: TokenClientConfig) => void;
  onTokenRequest?: (config?: TokenRequestConfig) => void;
  silentFails?: boolean;
  loginFails?: boolean;
  expiresIn?: number;
}): void {
  (globalThis as Record<string, unknown>).google = {
    accounts: {
      oauth2: {
        initTokenClient: (config: TokenClientConfig) => {
          options?.onTokenInit?.(config);
          return {
            requestAccessToken: (overrideConfig?: TokenRequestConfig) => {
              options?.onTokenRequest?.(overrideConfig);
              if (overrideConfig?.prompt === "" && options?.silentFails) {
                config.callback({ error: "interaction_required" });
                return;
              }
              if (overrideConfig?.prompt !== "" && options?.loginFails) {
                config.callback({ error: "access_denied" });
                return;
              }
              config.callback({
                access_token: "test-access-token",
                expires_in: options?.expiresIn ?? 3600,
              });
            },
          };
        },
        revoke: (_token: string, callback: () => void) => callback(),
      },
    },
  };
}

export function clearGoogleOAuthMock(): void {
  delete (globalThis as { google?: unknown }).google;
}
