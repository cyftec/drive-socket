# @cyftec/drive-socket

Google Drive `appDataFolder` messaging for static PWAs — push immutable file messages, receive metadata or full blobs, and prune old messages. TypeScript source is published as-is (no build step).

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
3. Pass the client ID to `DriveSocket`.

## Usage

```typescript
import { DriveSocket } from "@cyftec/drive-socket";

const socket = new DriveSocket({ clientId: "YOUR_CLIENT_ID.apps.googleusercontent.com" });

await socket.connect();

// Push a JSON message
const fileBlob = new Blob([JSON.stringify({ hello: "world" })], {
  type: "application/json",
});

const sent = await socket.push(fileBlob, { mimeType: "application/json" });

// Receive latest message (metadata only)
const [latestMeta] = await socket.receive({
  as: "file-message-metadata",
  limit: 1,
});

// Receive with file content
const [latest] = await socket.receive({
  as: "file-message",
  limit: 1,
});
const text = await latest.fileBlob.text();

// Prune: keep last 10 messages
await socket.pruneByCount({ keep: 10 });

await socket.disconnect();
```

## API

| Method | Description |
|--------|-------------|
| `connect()` | Google OAuth sign-in (`drive.appdata` scope) |
| `disconnect()` | Revoke token |
| `isAuthenticated()` | Whether an access token is held |
| `push(fileBlob, { mimeType })` | Upload immutable message to `appDataFolder` |
| `receive({ as, since?, until?, limit? })` | List metadata or download full messages |
| `getById(fileId)` | Fetch one message by Drive file ID |
| `pruneByCount({ keep, dryRun? })` | Delete older messages, keep newest N |
| `pruneBefore({ before, dryRun? })` | Delete messages older than a date |

`receive` modes:

- `"file-message-metadata"` — `FileMessageMetadata[]` (no blob download)
- `"file-message"` — `FileMessage[]` (includes `fileBlob`)

## MIME types

Only Google-supported MIME types in the package allowlist are accepted on `push`. HTML, CSS, and JavaScript MIME types are excluded. See exported `MIME_TO_EXTENSION`, `SUPPORTED_MIME_TYPES`, and `SupportedMimeType`.

## License

MIT
