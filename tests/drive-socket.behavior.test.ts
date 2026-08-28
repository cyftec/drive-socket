import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import {
  FilenameExtensionMismatchError,
  InvalidMimeError,
  MessageExistsError,
  NotAuthenticatedError,
} from "../src/errors/index.ts";
import { DriveSocket } from "../src/index.ts";
import type { DriveSocketConfig, OnReceiveEvent } from "../src/types/index.ts";
import {
  DRIVE_APPDATA_SCOPE,
  FOLDER_MIME_TYPE,
  GOOGLE_TOKEN_URL,
} from "../src/google/constants.ts";
import { clearGoogleOAuthMock, installGoogleOAuthMock } from "./mocks/google.ts";
import { DriveApiFixture } from "./mocks/drive-api.ts";

const TOKEN_KEY = "drive-socket:tokens:client-id:messages";

function defaultConfig(
  overrides: Partial<DriveSocketConfig> = {},
): DriveSocketConfig {
  return {
    clientId: "client-id",
    folderName: "messages",
    pollIntervalInMs: 100,
    maxFiles: 10,
    ...overrides,
  };
}

function installLocalStorageMock(): { storage: Map<string, string> } {
  const storage = new Map<string, string>();
  const mock = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
    key: (_index: number) => null,
    length: 0,
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: mock,
    configurable: true,
  });
  return { storage };
}

function listQueryFromUrl(url: string): string | null {
  return new URL(url).searchParams.get("q");
}

function installBrowserGlobals(): void {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  Object.defineProperty(globalThis, "window", {
    value: globalThis,
    configurable: true,
  });

  Object.defineProperty(globalThis, "document", {
    value: {
      visibilityState: "visible",
      addEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
      },
      dispatchEvent: (event: Event) => {
        const typeListeners = listeners.get(event.type);
        if (typeListeners) {
          for (const listener of typeListeners) {
            if (typeof listener === "function") {
              listener(event);
            } else {
              listener.handleEvent(event);
            }
          }
        }
        return true;
      },
    },
    configurable: true,
  });
}

describe("DriveSocket", () => {
  let drive: DriveApiFixture;
  let restoreFetch: () => void;
  let localStorageMock: { storage: Map<string, string> };

  beforeEach(() => {
    installBrowserGlobals();
    drive = new DriveApiFixture();
    localStorageMock = installLocalStorageMock();
    installGoogleOAuthMock();
    restoreFetch = drive.installFetch();
  });

  afterEach(() => {
    restoreFetch();
    clearGoogleOAuthMock();
  });

  describe("config validation", () => {
    it("rejects non-positive pollIntervalInMs", () => {
      expect(() => new DriveSocket(defaultConfig({ pollIntervalInMs: 0 }))).toThrow(
        "pollIntervalInMs must be > 0",
      );
    });

    it("rejects negative maxFiles", () => {
      expect(() => new DriveSocket(defaultConfig({ maxFiles: -1 }))).toThrow(
        "maxFiles must be >= 0",
      );
    });

    it("rejects empty folderName", () => {
      expect(() => new DriveSocket(defaultConfig({ folderName: "" }))).toThrow(
        "folderName must not be empty",
      );
    });
  });

  describe("auth", () => {
    it("loads tokens from localStorage on connect and clears storage", async () => {
      localStorageMock.storage.set(
        TOKEN_KEY,
        JSON.stringify({
          accessToken: "stored-access",
          refreshToken: "stored-refresh",
          expiresAt: Date.now() + 3600_000,
        }),
      );

      const socket = new DriveSocket(defaultConfig());
      await socket.connect({ interactive: false });

      expect(localStorageMock.storage.has(TOKEN_KEY)).toBe(false);
      await expect(
        socket.push(new Blob(["{}"]), {
          mimeType: "application/json",
          fileName: "a.json",
        }),
      ).resolves.toBeDefined();
    });

    it("silently refreshes expired tokens on connect", async () => {
      localStorageMock.storage.set(
        TOKEN_KEY,
        JSON.stringify({
          accessToken: "expired-access",
          refreshToken: "stored-refresh",
          expiresAt: Date.now() - 1000,
        }),
      );

      const socket = new DriveSocket(defaultConfig());
      await socket.connect({ interactive: false });

      expect(
        drive.requests.some(
          ({ url, method }) =>
            url === GOOGLE_TOKEN_URL && method === "POST",
        ),
      ).toBe(true);
    });

    it("interactive connect uses code client with drive.appdata scope", async () => {
      let capturedScope = "";
      clearGoogleOAuthMock();
      installGoogleOAuthMock({
        onCodeInit: (config) => {
          capturedScope = config.scope;
        },
      });

      const socket = new DriveSocket(defaultConfig());
      await socket.connect();

      expect(capturedScope).toBe(DRIVE_APPDATA_SCOPE);
      expect(
        drive.requests.some(
          ({ url, method }) =>
            url === GOOGLE_TOKEN_URL && method === "POST",
        ),
      ).toBe(true);
    });

    it("persists tokens to localStorage when visibility becomes hidden", async () => {
      const socket = new DriveSocket(defaultConfig());
      await socket.connect();

      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));

      const raw = localStorageMock.storage.get(TOKEN_KEY);
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!) as { accessToken: string };
      expect(parsed.accessToken).toBe("test-access-token");
    });

    it("disconnect revokes and clears persisted tokens", async () => {
      const socket = new DriveSocket(defaultConfig());
      await socket.connect();
      await socket.disconnect();

      expect(localStorageMock.storage.has(TOKEN_KEY)).toBe(false);
    });
  });

  describe("push", () => {
    it("rejects unsupported mime types", async () => {
      const socket = new DriveSocket(defaultConfig());
      await socket.connect();

      await expect(
        socket.push(new Blob(["x"]), {
          mimeType: "text/html",
          fileName: "x.html",
        }),
      ).rejects.toBeInstanceOf(InvalidMimeError);
    });

    it("rejects filename extension mismatch", async () => {
      const socket = new DriveSocket(defaultConfig());
      await socket.connect();

      await expect(
        socket.push(new Blob(["{}"]), {
          mimeType: "application/json",
          fileName: "wrong.txt",
        }),
      ).rejects.toBeInstanceOf(FilenameExtensionMismatchError);
    });

    it("rejects when not authenticated", async () => {
      const socket = new DriveSocket(defaultConfig({ pollIntervalInMs: 50_000 }));

      await expect(
        socket.push(new Blob(["{}"]), {
          mimeType: "application/json",
          fileName: "a.json",
        }),
      ).rejects.toBeInstanceOf(NotAuthenticatedError);
    });

    it("uploads into the configured appData subfolder", async () => {
      const socket = new DriveSocket(defaultConfig());
      await socket.connect();

      const folder = drive.addFolder({
        id: "folder-1",
        name: "messages",
        parentId: "appDataFolder",
      });

      await socket.push(new Blob(['{"hello":"world"}']), {
        mimeType: "application/json",
        fileName: "hello.json",
      });

      const uploadRequest = drive.requests.find(
        ({ method, url }) =>
          method === "POST" && url.includes("uploadType=multipart"),
      );
      expect(uploadRequest?.url).toBeDefined();
      const uploaded = [...drive.files.values()].find((f) => f.name === "hello.json");
      expect(uploaded?.parentId).toBe(folder.id);
    });

    it("rejects duplicate file names in folder", async () => {
      const socket = new DriveSocket(defaultConfig());
      await socket.connect();

      const folder = drive.addFolder({
        id: "folder-1",
        name: "messages",
        parentId: "appDataFolder",
      });
      drive.addFile({
        name: "dup.json",
        parentId: folder.id,
      });

      await expect(
        socket.push(new Blob(["{}"]), {
          mimeType: "application/json",
          fileName: "dup.json",
        }),
      ).rejects.toBeInstanceOf(MessageExistsError);
    });

    it("requests configured metadata fields on upload", async () => {
      const socket = new DriveSocket<"md5Checksum">({
        ...defaultConfig(),
        metadataFields: ["md5Checksum"],
      });
      await socket.connect();
      drive.addFolder({ id: "folder-1", name: "messages", parentId: "appDataFolder" });

      await socket.push(new Blob(["{}"]), {
        mimeType: "application/json",
        fileName: "meta.json",
      });

      const uploadRequest = drive.requests.find(
        ({ method, url }) =>
          method === "POST" && url.includes("uploadType=multipart"),
      );
      expect(uploadRequest?.url).toContain(
        "fields=id,name,createdTime,mimeType,size,md5Checksum",
      );
    });
  });

  describe("onReceive", () => {
    it("emits metadata then file events newest-first", async () => {
      const socket = new DriveSocket(defaultConfig({ pollIntervalInMs: 200 }));
      await socket.connect();

      const folder = drive.addFolder({
        id: "folder-1",
        name: "messages",
        parentId: "appDataFolder",
      });
      drive.addFile({
        id: "older",
        name: "older.json",
        createdTime: "2026-01-01T00:00:00.000Z",
        parentId: folder.id,
        fileBlob: new Blob(["older"]),
      });
      drive.addFile({
        id: "newer",
        name: "newer.json",
        createdTime: "2026-01-02T00:00:00.000Z",
        parentId: folder.id,
        fileBlob: new Blob(["newer"]),
      });

      const events: OnReceiveEvent<"id" | "name" | "createdTime" | "mimeType" | "size">[] = [];
      socket.onReceive((event) => events.push(event));

      await new Promise((resolve) => setTimeout(resolve, 350));

      const metadataEvent = events.find((e) => e.type === "metadata");
      expect(metadataEvent?.type === "metadata" && metadataEvent.files.map((f) => f.id)).toEqual([
        "newer",
        "older",
      ]);

      const fileEvents = events.filter((e) => e.type === "file");
      expect(fileEvents.length).toBeGreaterThanOrEqual(2);
      const firstFile = fileEvents[0];
      expect(firstFile?.type === "file" && firstFile.message.id).toBe("newer");
    });

    it("stops polling after disconnect", async () => {
      const socket = new DriveSocket(defaultConfig({ pollIntervalInMs: 50 }));
      await socket.connect();
      drive.addFolder({ id: "folder-1", name: "messages", parentId: "appDataFolder" });

      const events: OnReceiveEvent<"id" | "name" | "createdTime" | "mimeType" | "size">[] = [];
      socket.onReceive((event) => events.push(event));

      await new Promise((resolve) => setTimeout(resolve, 80));
      const countBeforeDisconnect = events.length;
      await socket.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(events.length).toBe(countBeforeDisconnect);
    });
  });

  describe("idle prune", () => {
    it("deletes oldest files beyond maxFiles when idle", async () => {
      const originalIdle = globalThis.requestIdleCallback;
      globalThis.requestIdleCallback = ((callback: IdleRequestCallback) => {
        callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
        return 1;
      }) as typeof requestIdleCallback;

      try {
        const socket = new DriveSocket(
          defaultConfig({ maxFiles: 1, pollIntervalInMs: 50_000 }),
        );
        await socket.connect();

        const folder = drive.addFolder({
          id: "folder-1",
          name: "messages",
          parentId: "appDataFolder",
        });
        drive.addFile({
          id: "keep",
          createdTime: "2026-01-05T00:00:00.000Z",
          parentId: folder.id,
        });
        drive.addFile({
          id: "drop",
          createdTime: "2026-01-01T00:00:00.000Z",
          parentId: folder.id,
        });

        await socket.push(new Blob(["{}"]), {
          mimeType: "application/json",
          fileName: "trigger.json",
        });

        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(drive.files.has("keep")).toBe(true);
        expect(drive.files.has("drop")).toBe(false);
      } finally {
        globalThis.requestIdleCallback = originalIdle;
      }
    });
  });
});
