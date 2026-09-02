declare namespace google.accounts.oauth2 {
  interface TokenResponse {
    access_token?: string;
    error?: string;
    error_description?: string;
    expires_in?: number;
  }

  interface TokenClientConfig {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
  }

  interface OverridableTokenClientConfig {
    prompt?: string;
  }

  interface TokenClient {
    requestAccessToken: (overrideConfig?: OverridableTokenClientConfig) => void;
  }

  function initTokenClient(config: TokenClientConfig): TokenClient;
  function revoke(
    token: string,
    callback: (done: { successful: boolean }) => void,
  ): void;
}

declare const google: {
  accounts: {
    oauth2: typeof google.accounts.oauth2;
  };
};
