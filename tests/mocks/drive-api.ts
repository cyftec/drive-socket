import type { DriveMessage } from "../../src/types/index.ts";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

type StoredFile = DriveMessage & {
  createdTime: string;
  mimeType: string;
  parentId: string;
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseFileIdFromPath(pathname: string): string | null {
  const match = pathname.match(/\/files\/([^/?]+)/);
  return match?.[1] ?? null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesDriveQuery(file: StoredFile, query: string): boolean {
  const parentMatch = query.match(/'([^']+)' in parents/);
  if (parentMatch?.[1] && file.parentId !== parentMatch[1]) return false;

  const nameExactMatch = query.match(/name='((?:\\'|[^'])*)'/);
  if (nameExactMatch?.[1]) {
    const expectedName = nameExactMatch[1].replace(/\\'/g, "'");
    if (file.name !== expectedName) return false;
  }

  const folderMimeMatch = query.match(
    new RegExp(`mimeType='${escapeRegex(FOLDER_MIME_TYPE)}'`),
  );
  if (folderMimeMatch && file.mimeType !== FOLDER_MIME_TYPE) return false;

  return true;
}

function isFolderContentsListQuery(query: string): boolean {
  return /'[^']+' in parents and trashed=false$/.test(query);
}

export class DriveApiFixture {
  readonly files = new Map<string, StoredFile>();
  readonly requests: Array<{ method: string; url: string; at: number }> = [];
  listDelayMs = 0;
  downloadDelayMs = 0;
  folderContentsListDelayMs = 0;
  failDownloadIds = new Set<string>();
  private nextId = 1;

  addFile(overrides: Partial<StoredFile> = {}): StoredFile {
    const id = overrides.id ?? `file-${this.nextId++}`;
    const file: StoredFile = {
      id,
      name: overrides.name ?? "message.json",
      createdTime: overrides.createdTime ?? "2026-01-01T00:00:00.000Z",
      mimeType: overrides.mimeType ?? "application/json",
      fileBlob: overrides.fileBlob ?? new Blob(['{"hello":"world"}']),
      parentId: overrides.parentId ?? "appDataFolder",
    };
    this.files.set(id, file);
    return file;
  }

  addFolder(overrides: Partial<StoredFile> = {}): StoredFile {
    return this.addFile({
      ...overrides,
      mimeType: FOLDER_MIME_TYPE,
      fileBlob: new Blob(),
    });
  }

  installFetch(): () => void {
    const original = globalThis.fetch;

    const fetchMock = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method =
        init?.method ?? (input instanceof Request ? input.method : "GET");

      this.requests.push({ method, url, at: Date.now() });

      if (url.startsWith(DRIVE_UPLOAD) && method === "POST") {
        const id = `file-${this.nextId++}`;
        let name = "uploaded.bin";
        let mimeType = "application/octet-stream";
        let parentId = "appDataFolder";
        if (init?.body instanceof Blob) {
          const raw = await init.body.text();
          const nameMatch = raw.match(/"name":"([^"]+)"/);
          const mimeMatch = raw.match(/"mimeType":"([^"]+)"/);
          const parentMatch = raw.match(/"parents":\["([^"]+)"/);
          if (nameMatch?.[1]) name = nameMatch[1];
          if (mimeMatch?.[1]) mimeType = mimeMatch[1];
          if (parentMatch?.[1]) parentId = parentMatch[1];
        }
        const file: StoredFile = {
          id,
          name,
          createdTime: "2026-01-02T00:00:00.000Z",
          mimeType,
          fileBlob:
            mimeType === FOLDER_MIME_TYPE
              ? new Blob()
              : init?.body instanceof Blob
                ? new Blob([init.body])
                : new Blob(),
          parentId,
        };
        this.files.set(id, file);
        return jsonResponse({ id, name });
      }

      if (!url.startsWith(DRIVE_API)) {
        return original(input, init);
      }

      const parsed = new URL(url);

      if (method === "DELETE") {
        const id = parseFileIdFromPath(parsed.pathname);
        if (!id || !this.files.has(id)) {
          return new Response("not found", { status: 404 });
        }
        this.files.delete(id);
        return new Response(null, { status: 204 });
      }

      if (method === "POST") {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const id = `file-${this.nextId++}`;
        const file: StoredFile = {
          id,
          name: body.name ?? "folder",
          createdTime: new Date().toISOString(),
          mimeType: body.mimeType ?? FOLDER_MIME_TYPE,
          fileBlob: new Blob(),
          parentId: body.parents?.[0] ?? "appDataFolder",
        };
        this.files.set(id, file);
        return jsonResponse({ id });
      }

      if (method !== "GET") {
        return new Response("method not allowed", { status: 405 });
      }

      if (parsed.searchParams.get("alt") === "media") {
        const id = parseFileIdFromPath(parsed.pathname);
        const file = id ? this.files.get(id) : undefined;
        if (!file || (id && this.failDownloadIds.has(id))) {
          return new Response("not found", { status: 404 });
        }
        if (this.downloadDelayMs > 0) await sleep(this.downloadDelayMs);
        return new Response(file.fileBlob);
      }

      const query = parsed.searchParams.get("q");
      if (query) {
        if (this.listDelayMs > 0) await sleep(this.listDelayMs);
        if (
          this.folderContentsListDelayMs > 0 &&
          isFolderContentsListQuery(query)
        ) {
          await sleep(this.folderContentsListDelayMs);
        }

        const matched = [...this.files.values()]
          .filter((file) => matchesDriveQuery(file, query))
          .map(({ id, name, createdTime }) => ({ id, name, createdTime }));

        return jsonResponse({ files: matched });
      }

      return new Response("not found", { status: 404 });
    };

    globalThis.fetch = fetchMock as typeof fetch;

    return () => {
      globalThis.fetch = original;
    };
  }
}
