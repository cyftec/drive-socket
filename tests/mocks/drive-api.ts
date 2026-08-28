import {
  DRIVE_API,
  DRIVE_UPLOAD,
  FOLDER_MIME_TYPE,
  GOOGLE_TOKEN_URL,
} from "../../src/google/constants.ts";
import type { FileMetadata } from "../../src/types/index.ts";
import { sampleMetadata } from "../fixtures/metadata.ts";

type DefaultFileFields = "id" | "name" | "createdTime" | "mimeType" | "size";
type StoredFile = FileMetadata<DefaultFileFields> & {
  fileBlob: Blob;
  parentId: string;
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

  const gteMatch = query.match(/createdTime >= '([^']+)'/);
  if (gteMatch?.[1] && file.createdTime < gteMatch[1]) return false;

  const gtMatch = query.match(/createdTime > '([^']+)'/);
  if (gtMatch?.[1] && file.createdTime <= gtMatch[1]) return false;

  const lteMatch = query.match(/createdTime <= '([^']+)'/);
  if (lteMatch?.[1] && file.createdTime > lteMatch[1]) return false;

  const ltMatch = query.match(/createdTime < '([^']+)'/);
  if (ltMatch?.[1] && file.createdTime >= ltMatch[1]) return false;

  return true;
}

export class DriveApiFixture {
  readonly files = new Map<string, StoredFile>();
  readonly requests: Array<{ method: string; url: string }> = [];
  accessToken = "test-access-token";
  refreshToken = "test-refresh-token";
  private nextId = 1;
  private listPageCache = new Map<string, FileMetadata<DefaultFileFields>[]>();

  addFile(
    overrides: Partial<FileMetadata<DefaultFileFields>> & {
      fileBlob?: Blob;
      parentId?: string;
    } = {},
  ): StoredFile {
    const id = overrides.id ?? `file-${this.nextId++}`;
    const file: StoredFile = {
      ...sampleMetadata(overrides),
      id,
      fileBlob: overrides.fileBlob ?? new Blob(['{"hello":"world"}']),
      parentId: overrides.parentId ?? "appDataFolder",
    };
    this.files.set(id, file);
    return file;
  }

  addFolder(
    overrides: Partial<FileMetadata<DefaultFileFields>> & {
      parentId?: string;
    } = {},
  ): StoredFile {
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

      this.requests.push({ method, url });

      if (url === GOOGLE_TOKEN_URL && method === "POST") {
        const body =
          init?.body instanceof URLSearchParams
            ? init.body
            : new URLSearchParams(String(init?.body ?? ""));
        const grantType = body.get("grant_type");

        if (grantType === "refresh_token") {
          return jsonResponse({
            access_token: this.accessToken,
            expires_in: 3600,
          });
        }

        if (grantType === "authorization_code") {
          return jsonResponse({
            access_token: this.accessToken,
            refresh_token: this.refreshToken,
            expires_in: 3600,
          });
        }
      }

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
        const created = sampleMetadata({ id, name, mimeType });
        const fileBlob =
          mimeType === FOLDER_MIME_TYPE
            ? new Blob()
            : init?.body instanceof Blob
              ? new Blob([init.body])
              : new Blob();
        const stored: StoredFile = {
          ...created,
          fileBlob,
          parentId,
        };
        this.files.set(id, stored);
        return jsonResponse(created);
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
        const created = sampleMetadata({
          id,
          name: body.name ?? "folder",
          mimeType: body.mimeType ?? FOLDER_MIME_TYPE,
        });
        const stored: StoredFile = {
          ...created,
          fileBlob: new Blob(),
          parentId: body.parents?.[0] ?? "appDataFolder",
        };
        this.files.set(id, stored);
        return jsonResponse({ id });
      }

      if (method !== "GET") {
        return new Response("method not allowed", { status: 405 });
      }

      if (parsed.searchParams.get("alt") === "media") {
        const id = parseFileIdFromPath(parsed.pathname);
        const file = id ? this.files.get(id) : undefined;
        if (!file) return new Response("not found", { status: 404 });
        return new Response(file.fileBlob);
      }

      const query = parsed.searchParams.get("q");
      if (query) {
        const pageToken = parsed.searchParams.get("pageToken");
        const matched = [...this.files.values()]
          .filter((file) => matchesDriveQuery(file, query))
          .map(({ fileBlob: _fileBlob, parentId: _parentId, ...metadata }) => metadata);

        if (pageToken) {
          return jsonResponse({ files: this.listPageCache.get(pageToken) ?? [] });
        }

        if (matched.length > 2) {
          this.listPageCache.set("page-2", matched.slice(2));
          return jsonResponse({
            files: matched.slice(0, 2),
            nextPageToken: "page-2",
          });
        }

        return jsonResponse({ files: matched });
      }

      const id = parseFileIdFromPath(parsed.pathname);
      const file = id ? this.files.get(id) : undefined;
      if (!file) return new Response("not found", { status: 404 });
      const { fileBlob: _fileBlob, parentId: _parentId, ...metadata } = file;
      return jsonResponse(metadata);
    };

    globalThis.fetch = fetchMock as typeof fetch;

    return () => {
      globalThis.fetch = original;
    };
  }
}
