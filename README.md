# @cyftec/drive-socket

Google Drive `appDataFolder` messaging for static PWAs — push immutable file messages, receive them over a polling socket, and prune old messages automatically. TypeScript source is published as-is (no build step).

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
3. Pass the client ID and folder settings to `DriveSocket`.

## Usage

```typescript
import { DriveSocket } from "@cyftec/drive-socket";

const socket = new DriveSocket({
  clientId: "YOUR_CLIENT_ID.apps.googleusercontent.com",
  folderName: "my-app-messages",
  pollIntervalInMs: 5000,
  maxFiles: 20,
});

// First visit: user must click sign-in (OAuth popup)
await socket.connect();

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

On page load, `DriveSocket` silently restores tokens from `localStorage` (if present), moves them into memory, and clears storage immediately. While the tab is active, tokens live only in memory — `localStorage` stays empty. Tokens are written to `localStorage` only when the tab is hidden or the browser is closing, so sessions survive restarts without leaving credentials exposed during active use.

Sign-in uses the GIS token model (no backend `client_secret` required). After the user approves access once, the library silently requests new access tokens for hours-long sessions.

## API

| Method | Description |
|--------|-------------|
| `connect(options?)` | Restore tokens from `localStorage`, silent GIS token renewal, or interactive OAuth sign-in |
| `disconnect()` | Revoke token, stop polling, clear persisted tokens |
| `push(fileBlob, { mimeType, fileName })` | Upload immutable message into configured subfolder |
| `onReceive(callback)` | Poll on `pollIntervalInMs`; download and emit all folder files each cycle |

### `onReceive` poll cycle

Each cycle lasts `pollIntervalInMs`:

1. List all files in the configured folder
2. Download every file
3. Invoke the callback once with all `DriveMessage` values, sorted newest-first
4. Wait the remainder of the interval before the next cycle

### Config

| Property | Description |
|----------|-------------|
| `clientId` | Google OAuth Web client ID |
| `folderName` | Subfolder name inside `appDataFolder` |
| `pollIntervalInMs` | Poll cycle length in milliseconds |
| `maxFiles` | Maximum files kept in folder (oldest pruned on browser idle) |

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
