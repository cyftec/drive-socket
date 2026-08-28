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

// Receive messages: metadata list per cycle, then one file per callback
socket.onReceive(async (event) => {
  if (event.type === "metadata") {
    console.log("metadata", event.files.length);
    return;
  }
  const text = await event.message.fileBlob.text();
  console.log(event.message.name, text);
});

await socket.disconnect();
```

On page load, `DriveSocket` silently restores tokens from `localStorage` (if present) and refreshes them when needed. Tokens are written back to `localStorage` when the tab is hidden or closed — no manual token handling required.

## API

| Method | Description |
|--------|-------------|
| `connect(options?)` | Restore tokens from `localStorage`, silent refresh, or interactive OAuth sign-in |
| `disconnect()` | Revoke token, stop polling, clear persisted tokens |
| `push(fileBlob, { mimeType, fileName })` | Upload immutable message into configured subfolder |
| `onReceive(callback)` | Poll on `pollIntervalInMs`; emit metadata then stream file messages newest-first |

### `onReceive` poll cycle

Each cycle lasts `pollIntervalInMs`:

1. Fetch all file metadata in the configured folder → `{ type: "metadata", files }`
2. Download one file at a time (newest first) → `{ type: "file", message }` per file
3. If downloads exceed the interval, abort remaining and restart from the latest metadata
4. If all files finish early, wait the remainder of the interval before the next cycle

### Config

| Property | Description |
|----------|-------------|
| `clientId` | Google OAuth Web client ID |
| `folderName` | Subfolder name inside `appDataFolder` |
| `pollIntervalInMs` | Poll cycle length in milliseconds |
| `maxFiles` | Maximum files kept in folder (oldest pruned on browser idle) |
| `metadataFields?` | Extra Drive metadata fields beyond defaults |

## MIME types

Only Google-supported MIME types in the package allowlist are accepted on `push`. The filename extension must match the MIME type. HTML, CSS, and JavaScript MIME types are excluded. See exported `MIME_TO_EXTENSION`, `SUPPORTED_MIME_TYPES`, and `SupportedMimeType`.

## License

MIT
