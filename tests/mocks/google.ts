type TokenClientConfig = {
  client_id: string;
  scope: string;
  callback: (response: {
    access_token?: string;
    error?: string;
  }) => void;
};

export function installGoogleOAuthMock(options?: {
  accessToken?: string;
  grantScope?: boolean;
  onInit?: (config: TokenClientConfig) => void;
}): void {
  const accessToken = options?.accessToken ?? "test-access-token";

  (globalThis as Record<string, unknown>).google = {
    accounts: {
      oauth2: {
        initTokenClient: (config: TokenClientConfig) => {
          options?.onInit?.(config);
          return {
            requestAccessToken: () => {
              config.callback({ access_token: accessToken });
            },
          };
        },
        hasGrantedAllScopes: () => options?.grantScope ?? true,
        revoke: (_token: string, callback: () => void) => callback(),
      },
    },
  };
}

export function clearGoogleOAuthMock(): void {
  delete (globalThis as { google?: unknown }).google;
}
