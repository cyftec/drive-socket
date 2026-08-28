type CodeClientConfig = {
  client_id: string;
  scope: string;
  ux_mode?: string;
  access_type?: string;
  prompt?: string;
  callback: (response: { code?: string; error?: string }) => void;
};

export function installGoogleOAuthMock(options?: {
  grantScope?: boolean;
  onCodeInit?: (config: CodeClientConfig) => void;
}): void {
  (globalThis as Record<string, unknown>).google = {
    accounts: {
      oauth2: {
        initCodeClient: (config: CodeClientConfig) => {
          options?.onCodeInit?.(config);
          return {
            requestCode: () => {
              config.callback({ code: "test-auth-code" });
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
