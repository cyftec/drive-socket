# @cyftec/drive-socket

Google Drive `appDataFolder` messaging for static PWAs — push immutable file messages, receive them over a polling socket, and prune old messages on push. TypeScript source is published as-is (no build step).

## Requirements

- Browser environment (OAuth via Google Identity Services)
- Google Cloud OAuth 2.0 client ID (Web application)
- OAuth scope: `https://www.googleapis.com/auth/drive.appdata`
- TypeScript ^5 (package ships `.ts` sources)

## Install

```bash
npm install @cyftec/drive-socket
```

## Setup

1. Create a Google Cloud project and OAuth **Web client** credentials.
2. Add your PWA origin to authorized JavaScript origins.
3. Create a `GoogleOAuth` instance and pass it to `DriveSocket.connect`.

## Usage

```typescript
import { DriveSocket, getOAuthSingleton } from "@cyftec/drive-socket";

const oauth = getOAuthSingleton({
  googleApiClientId: "YOUR_CLIENT_ID.apps.googleusercontent.com",
  googleOAuthTokenScopes: "https://www.googleapis.com/auth/drive.appdata",
});

// First visit: user must click sign-in (OAuth popup)
await oauth.authenticate();

const socket = await DriveSocket.connect(
  {
    clientType: "single-tenant",
    rootPath: "my-app/messages",
    pollIntervalInMs: 5000,
    maxFiles: 20,
  },
  oauth,
);

// Push a JSON message with a user-provided filename
const fileBlob = new Blob([JSON.stringify({ hello: "world" })], {
  type: "application/json",
});

await socket.push(fileBlob, {
  mimeType: "application/json",
  fileName: "hello.json",
});

// Receive all folder files each poll cycle (downloaded, newest first)
socket.onReceive(async (messages) => {
  for (const message of messages) {
    const text = await message.fileBlob.text();
    console.log(message.name, text);
  }
});

await socket.disconnect();
```

On authenticate, `GoogleOAuth` restores tokens from `localStorage` when present, or requests new ones via GIS (silent renewal first, then interactive sign-in). Acquired tokens are persisted to `localStorage` for session continuity across page reloads.

Sign-in uses the GIS token model (no backend `client_secret` required). After the user approves access once, the library silently requests new access tokens for hours-long sessions.

## API

| Method | Description |
|--------|-------------|
| `DriveSocket.connect(config, oauth)` | Authenticate via `oauth`, resolve `rootPath`, return a connected socket |
| `disconnect()` | Stop polling and mark the socket inactive |
| `push(fileBlob, { mimeType, fileName })` | Upload immutable message; returns immediately while prune runs in the background |
| `onReceive(callback)` | Poll on `pollIntervalInMs`; download and emit all folder files each cycle |

### `onReceive` poll cycle

Each cycle:

1. List all files in the configured folder
2. Download every file
3. Invoke the callback once with all `DriveMessage` values, sorted newest-first
4. Wait the full `pollIntervalInMs`, then start the next cycle

If a cycle is still running when `pollIntervalInMs` would elapse, the timer is held until that cycle finishes. The next cycle always starts after a full `pollIntervalInMs` wait from completion — elapsed work time is not subtracted from the interval.

### Config

| Property | Description |
|----------|-------------|
| `clientType` | `"single-tenant"` (`appDataFolder` / `drive.appdata`) or `"multi-tenant"` (`drive` / `drive.file`) |
| `rootPath` | Folder path under the space (created if missing) |
| `pollIntervalInMs` | Poll cycle length in milliseconds |
| `maxFiles` | Maximum files kept in folder (oldest pruned in the background after each `push`) |

### `DriveMessage`

| Property | Description |
|----------|-------------|
| `id` | Google Drive file ID |
| `name` | File name in the folder |
| `fileBlob` | Downloaded file contents |

## MIME types

Only Google-supported MIME types in the package allowlist are accepted on `push`. The filename extension must match the MIME type. HTML, CSS, and JavaScript MIME types are excluded. See exported `MIME_TO_EXTENSION` and `SupportedMimeType`.

## License

MIT
