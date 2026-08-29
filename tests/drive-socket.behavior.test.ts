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
import type { DriveMessage, DriveSocketConfig } from "../src/types/index.ts";
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

    it("silently renews expired tokens on connect via GIS", async () => {
      let silentRequestCount = 0;
      clearGoogleOAuthMock();
      installGoogleOAuthMock({
        onTokenRequest: (config) => {
          if (config?.prompt === "") silentRequestCount += 1;
        },
      });

      localStorageMock.storage.set(
        TOKEN_KEY,
        JSON.stringify({
          accessToken: "expired-access",
          expiresAt: Date.now() - 1000,
        }),
      );

      const socket = new DriveSocket(defaultConfig());
      await socket.connect({ interactive: false });

      expect(silentRequestCount).toBeGreaterThan(0);
    });

    it("interactive connect uses token client with drive.appdata scope", async () => {
      let capturedScope = "";
      clearGoogleOAuthMock();
      installGoogleOAuthMock({
        onTokenInit: (config) => {
          capturedScope = config.scope;
        },
      });

      const socket = new DriveSocket(defaultConfig());
      await socket.connect();

      expect(capturedScope).toBe(
        "https://www.googleapis.com/auth/drive.appdata",
      );
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

    it("clears localStorage when tab becomes visible again", async () => {
      const socket = new DriveSocket(defaultConfig());
      await socket.connect();

      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      expect(localStorageMock.storage.has(TOKEN_KEY)).toBe(true);

      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));

      expect(localStorageMock.storage.has(TOKEN_KEY)).toBe(false);
      await expect(
        socket.push(new Blob(["{}"]), {
          mimeType: "application/json",
          fileName: "still-auth.json",
        }),
      ).resolves.toBeDefined();
    });

    it("keeps localStorage empty while tab stays visible after connect", async () => {
      const socket = new DriveSocket(defaultConfig());
      await socket.connect();

      expect(localStorageMock.storage.has(TOKEN_KEY)).toBe(false);
      await expect(
        socket.push(new Blob(["{}"]), {
          mimeType: "application/json",
          fileName: "active.json",
        }),
      ).resolves.toBeDefined();
      expect(localStorageMock.storage.has(TOKEN_KEY)).toBe(false);
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
      clearGoogleOAuthMock();
      installGoogleOAuthMock({ silentFails: true });

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

    it("returns uploaded message with fileBlob", async () => {
      const socket = new DriveSocket(defaultConfig());
      await socket.connect();
      drive.addFolder({ id: "folder-1", name: "messages", parentId: "appDataFolder" });

      const fileBlob = new Blob(["{}"]);
      const message = await socket.push(fileBlob, {
        mimeType: "application/json",
        fileName: "meta.json",
      });

      expect(message.fileBlob).toBe(fileBlob);
      expect(message.name).toBe("meta.json");
      expect(message.id).toBeTruthy();
    });
  });

  describe("onReceive", () => {
    it("emits all downloaded files newest-first in one callback", async () => {
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

      const batches: DriveMessage[][] = [];
      socket.onReceive((messages) => batches.push(messages));

      await new Promise((resolve) => setTimeout(resolve, 350));

      const latestBatch = batches.at(-1);
      expect(latestBatch?.map((message) => message.id)).toEqual(["newer", "older"]);
      expect(latestBatch?.every((message) => message.fileBlob instanceof Blob)).toBe(
        true,
      );
    });

    it("renews expired tokens during polling without user interaction", async () => {
      let silentRequestCount = 0;
      clearGoogleOAuthMock();
      installGoogleOAuthMock({
        expiresIn: 61,
        onTokenRequest: (config) => {
          if (config?.prompt === "") silentRequestCount += 1;
        },
      });

      const socket = new DriveSocket(defaultConfig({ pollIntervalInMs: 100 }));
      await socket.connect();
      drive.addFolder({ id: "folder-1", name: "messages", parentId: "appDataFolder" });

      await new Promise((resolve) => setTimeout(resolve, 1_100));

      const batches: DriveMessage[][] = [];
      socket.onReceive((messages) => batches.push(messages));

      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(silentRequestCount).toBeGreaterThan(0);
      expect(batches.length).toBeGreaterThan(0);
    });

    it("stops polling after disconnect", async () => {
      const socket = new DriveSocket(defaultConfig({ pollIntervalInMs: 50 }));
      await socket.connect();
      drive.addFolder({ id: "folder-1", name: "messages", parentId: "appDataFolder" });

      const batches: DriveMessage[][] = [];
      socket.onReceive((messages) => batches.push(messages));

      await new Promise((resolve) => setTimeout(resolve, 80));
      const countBeforeDisconnect = batches.length;
      await socket.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(batches.length).toBe(countBeforeDisconnect);
    });

    it("waits full pollIntervalInMs after a cycle completes before polling again", async () => {
      const pollIntervalInMs = 80;
      drive.listDelayMs = 120;

      const socket = new DriveSocket(defaultConfig({ pollIntervalInMs }));
      await socket.connect();
      drive.addFolder({ id: "folder-1", name: "messages", parentId: "appDataFolder" });

      const callbackTimes: number[] = [];
      socket.onReceive(() => callbackTimes.push(Date.now()));

      await new Promise((resolve) => setTimeout(resolve, 700));

      expect(callbackTimes.length).toBeGreaterThanOrEqual(2);
      const gapBetweenCallbacks = callbackTimes[1]! - callbackTimes[0]!;
      expect(gapBetweenCallbacks).toBeGreaterThanOrEqual(
        drive.listDelayMs + pollIntervalInMs - 40,
      );
    });

    it("waits full pollIntervalInMs after downloads finish before polling again", async () => {
      const pollIntervalInMs = 80;
      drive.downloadDelayMs = 120;

      const socket = new DriveSocket(defaultConfig({ pollIntervalInMs }));
      await socket.connect();

      const folder = drive.addFolder({
        id: "folder-1",
        name: "messages",
        parentId: "appDataFolder",
      });
      drive.addFile({
        id: "file-1",
        name: "slow.json",
        parentId: folder.id,
        fileBlob: new Blob(["slow"]),
      });

      const callbackTimes: number[] = [];
      socket.onReceive(() => callbackTimes.push(Date.now()));

      await new Promise((resolve) => setTimeout(resolve, 700));

      expect(callbackTimes.length).toBeGreaterThanOrEqual(2);
      const gapBetweenCallbacks = callbackTimes[1]! - callbackTimes[0]!;
      expect(gapBetweenCallbacks).toBeGreaterThanOrEqual(
        drive.downloadDelayMs + pollIntervalInMs - 40,
      );
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
