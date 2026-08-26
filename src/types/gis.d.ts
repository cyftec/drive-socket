declare namespace google.accounts.oauth2 {
  interface TokenResponse {
    access_token?: string;
    error?: string;
    expires_in?: number;
    scope?: string;
  }

  interface TokenClientConfig {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
  }

  interface TokenClient {
    requestAccessToken: () => void;
  }

  function initTokenClient(config: TokenClientConfig): TokenClient;
  function hasGrantedAllScopes(response: TokenResponse, ...scopes: string[]): boolean;
  function revoke(token: string, callback: (done: { successful: boolean }) => void): void;
}

declare const google: {
  accounts: {
    oauth2: typeof google.accounts.oauth2;
  };
};
