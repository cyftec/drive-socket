import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  FilenameExtensionMismatchError,
  InvalidMimeError,
  MessageExistsError,
  NotAuthenticatedError,
} from "../src/errors/index.ts";
import {
  DriveSocket,
  type DriveMessage,
  type DriveSocketConfig,
} from "../src/index.ts";
import {
  clearGoogleOAuthMock,
  installGoogleOAuthMock,
} from "./mocks/google.ts";
import { DriveApiFixture } from "./mocks/drive-api.ts";
import {
  DRIVE_APPDATA_SCOPE,
  getTestOAuth,
  TOKEN_KEY,
  type GoogleOAuth,
} from "./mocks/oauth-harness.ts";
import { getOAuthSingleton } from "../src/google/oauth.ts";

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

function defaultConfig(
  overrides: Partial<DriveSocketConfig> = {},
): DriveSocketConfig {
  return {
    clientType: "single-tenant",
    rootPath: "messages",
    pollIntervalInMs: 100,
    maxFiles: 10,
    ...overrides,
  };
}

function createMockOAuth(scopes: string): GoogleOAuth {
  return {
    getConfiguredScopes: () => scopes,
    authenticate: async () => {},
    authorizedFetch: (url, init) => fetch(url, init),
  } as GoogleOAuth;
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

describe("DriveSocket", () => {
  let drive: DriveApiFixture;
  let restoreFetch: () => void;
  let localStorageMock: { storage: Map<string, string> };
  let oauth: GoogleOAuth;
  const openSockets: DriveSocket[] = [];

  function createSocket(overrides: Partial<DriveSocketConfig> = {}): DriveSocket {
    const socket = new DriveSocket(defaultConfig(overrides), oauth);
    openSockets.push(socket);
    return socket;
  }

  function addMessagesFolder() {
    return drive.addFolder({
      id: "folder-1",
      name: "messages",
      parentId: "appDataFolder",
    });
  }

  async function connectSocket(socket: DriveSocket): Promise<void> {
    await oauth.authenticate();
    await socket.connect();
  }

  beforeEach(() => {
    drive = new DriveApiFixture();
    localStorageMock = installLocalStorageMock();
    installGoogleOAuthMock();
    oauth = getTestOAuth();
    restoreFetch = drive.installFetch();
  });

  afterEach(async () => {
    await Promise.all(
      openSockets.splice(0).map((socket) => socket.disconnect()),
    );
    restoreFetch();
    clearGoogleOAuthMock();
  });

  describe("config validation", () => {
    it("rejects non-positive pollIntervalInMs", () => {
      expect(
        () =>
          new DriveSocket(
            defaultConfig({ pollIntervalInMs: 0 }),
            createMockOAuth(DRIVE_APPDATA_SCOPE),
          ),
      ).toThrow("pollIntervalInMs must be > 0");
    });

    it("rejects negative maxFiles", () => {
      expect(
        () =>
          new DriveSocket(
            defaultConfig({ maxFiles: -1 }),
            createMockOAuth(DRIVE_APPDATA_SCOPE),
          ),
      ).toThrow("maxFiles must be >= 0");
    });

    it("rejects empty rootPath", () => {
      expect(
        () =>
          new DriveSocket(
            defaultConfig({ rootPath: "" }),
            createMockOAuth(DRIVE_APPDATA_SCOPE),
          ),
      ).toThrow("rootPath must not be empty");
    });
  });

  describe("clientType", () => {
    it("single-tenant uses appDataFolder space", async () => {
      addMessagesFolder();
      const socket = createSocket({ clientType: "single-tenant", rootPath: "messages" });
      await connectSocket(socket);

      await socket.push(new Blob(["{}"]), {
        mimeType: "application/json",
        fileName: "tenant.json",
      });

      const listRequest = drive.requests.find(
        (request) =>
          request.method === "GET" && request.url.includes("spaces=appDataFolder"),
      );
      expect(listRequest).toBeDefined();
    });

    it("multi-tenant uses drive space", async () => {
      clearGoogleOAuthMock();
      installGoogleOAuthMock();
      oauth = createMockOAuth(DRIVE_FILE_SCOPE) as GoogleOAuth;

      const socket = new DriveSocket(
        defaultConfig({ clientType: "multi-tenant", rootPath: "shared-sync" }),
        oauth,
      );
      openSockets.push(socket);
      await oauth.authenticate();
      await socket.connect();

      await socket.push(new Blob(["{}"]), {
        mimeType: "application/json",
        fileName: "sync.json",
      });

      const listRequest = drive.requests.find(
        (request) =>
          request.method === "GET" && request.url.includes("spaces=drive"),
      );
      expect(listRequest).toBeDefined();

      const created = [...drive.files.values()].find(
        (file) => file.name === "shared-sync",
      );
      expect(created?.parentId).toBe("root");
    });
  });

  describe("auth", () => {
    it("loads tokens from localStorage on authenticate", async () => {
      localStorageMock.storage.set(
        TOKEN_KEY,
        JSON.stringify({
          accessToken: "stored-access",
          expiresAt: Date.now() + 3600_000,
        }),
      );

      const socket = createSocket();
      await oauth.authenticate();
      await connectSocket(socket);

      const raw = localStorageMock.storage.get(TOKEN_KEY);
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!) as { accessToken: string };
      expect(parsed.accessToken).toBe("stored-access");
      await expect(
        socket.push(new Blob(["{}"]), {
          mimeType: "application/json",
          fileName: "a.json",
        }),
      ).resolves.toBeDefined();
    });

    it("silently renews expired tokens on authenticate via GIS", async () => {
      let silentRequestCount = 0;
      clearGoogleOAuthMock();
      installGoogleOAuthMock({
        onTokenRequest: (config) => {
          if (config?.prompt === "none") silentRequestCount += 1;
        },
      });

      localStorageMock.storage.set(
        TOKEN_KEY,
        JSON.stringify({
          accessToken: "expired-access",
          expiresAt: Date.now() - 1000,
        }),
      );

      await oauth.authenticate();

      expect(silentRequestCount).toBeGreaterThan(0);
    });

    it("authenticate rejects when silent and login both fail", async () => {
      clearGoogleOAuthMock();
      installGoogleOAuthMock({ silentFails: true, loginFails: true });

      await expect(oauth.authenticate()).rejects.toBeInstanceOf(
        NotAuthenticatedError,
      );
    });

    it("connect resolves folder setup after authenticate", async () => {
      addMessagesFolder();
      const socket = createSocket();

      await connectSocket(socket);

      socket.onReceive(() => {});
      expect(() => socket.start()).not.toThrow();
    });

    it("authenticate uses token client with configured scopes", async () => {
      let capturedScope = "";
      clearGoogleOAuthMock();
      installGoogleOAuthMock({
        onTokenInit: (config) => {
          capturedScope = config.scope;
        },
      });

      await oauth.authenticate();

      expect(capturedScope).toBe(DRIVE_APPDATA_SCOPE);
    });

    it("allows only one oauth singleton per page", () => {
      expect(() =>
        getOAuthSingleton({
          googleApiClientId: "other-client",
          googleOAuthTokenScopes: DRIVE_APPDATA_SCOPE,
        }),
      ).toThrow(/one oauth singleton per html page/i);
    });

    it("persists tokens to localStorage after authenticate", async () => {
      await oauth.authenticate();

      const raw = localStorageMock.storage.get(TOKEN_KEY);
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!) as { accessToken: string };
      expect(parsed.accessToken).toBe("test-access-token");
    });

    it("keeps persisted tokens in localStorage after connect", async () => {
      const socket = createSocket();
      await connectSocket(socket);

      expect(localStorageMock.storage.has(TOKEN_KEY)).toBe(true);
      await expect(
        socket.push(new Blob(["{}"]), {
          mimeType: "application/json",
          fileName: "active.json",
        }),
      ).resolves.toBeDefined();
      expect(localStorageMock.storage.has(TOKEN_KEY)).toBe(true);
    });

    it("disconnect leaves oauth tokens in localStorage", async () => {
      const socket = createSocket();
      await connectSocket(socket);
      expect(localStorageMock.storage.has(TOKEN_KEY)).toBe(true);

      await socket.disconnect();

      expect(localStorageMock.storage.has(TOKEN_KEY)).toBe(true);
    });
  });

  describe("push", () => {
    it("rejects unsupported mime types", async () => {
      const socket = createSocket();
      await connectSocket(socket);

      await expect(
        socket.push(new Blob(["x"]), {
          mimeType: "text/html",
          fileName: "x.html",
        }),
      ).rejects.toBeInstanceOf(InvalidMimeError);
    });

    it("rejects filename extension mismatch", async () => {
      const socket = createSocket();
      await connectSocket(socket);

      await expect(
        socket.push(new Blob(["{}"]), {
          mimeType: "application/json",
          fileName: "wrong.txt",
        }),
      ).rejects.toBeInstanceOf(FilenameExtensionMismatchError);
    });

    it("rejects when not authenticated", async () => {
      clearGoogleOAuthMock();
      installGoogleOAuthMock({ silentFails: true, loginFails: true });

      const socket = createSocket({ pollIntervalInMs: 50_000 });

      await expect(socket.connect()).rejects.toBeInstanceOf(
        NotAuthenticatedError,
      );
    });

    it("uploads into the configured appData subfolder", async () => {
      const folder = addMessagesFolder();
      const socket = createSocket();
      await connectSocket(socket);

      await socket.push(new Blob(['{"hello":"world"}']), {
        mimeType: "application/json",
        fileName: "hello.json",
      });

      const uploadRequest = drive.requests.find(
        ({ method, url }) =>
          method === "POST" && url.includes("uploadType=multipart"),
      );
      expect(uploadRequest?.url).toBeDefined();
      const uploaded = [...drive.files.values()].find(
        (f) => f.name === "hello.json",
      );
      expect(uploaded?.parentId).toBe(folder.id);
    });

    it("rejects duplicate file names in folder", async () => {
      const folder = addMessagesFolder();
      drive.addFile({
        name: "dup.json",
        parentId: folder.id,
      });
      const socket = createSocket();
      await connectSocket(socket);

      await expect(
        socket.push(new Blob(["{}"]), {
          mimeType: "application/json",
          fileName: "dup.json",
        }),
      ).rejects.toBeInstanceOf(MessageExistsError);
    });

    it("returns uploaded message with fileBlob", async () => {
      const socket = createSocket();
      await connectSocket(socket);
      drive.addFolder({
        id: "folder-1",
        name: "messages",
        parentId: "appDataFolder",
      });

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
    it("is not running until start is called", () => {
      const socket = createSocket();
      expect(socket.isRunning).toBe(false);
    });

    it("rejects start before connect", () => {
      const socket = createSocket();
      socket.onReceive(() => {});
      expect(() => socket.start()).toThrow(
        "Not connected. Call connect() first.",
      );
    });

    it("rejects start without onReceive", async () => {
      addMessagesFolder();
      const socket = createSocket();
      await connectSocket(socket);
      expect(() => socket.start()).toThrow(
        "No receive callback registered. Call onReceive() first.",
      );
    });

    it("rejects start after disconnect", async () => {
      addMessagesFolder();
      const socket = createSocket();
      await connectSocket(socket);
      socket.onReceive(() => {});
      await socket.disconnect();
      expect(() => socket.start()).toThrow(
        "Not connected. Call connect() first.",
      );
    });

    it("does not poll until connected and start is called", async () => {
      addMessagesFolder();
      const socket = createSocket({ pollIntervalInMs: 200 });
      const batches: DriveMessage[][] = [];
      socket.onReceive((messages) => batches.push(messages));

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(batches).toHaveLength(0);

      await connectSocket(socket);
      socket.start();

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(batches.length).toBeGreaterThan(0);
      expect(socket.isRunning).toBe(true);
    });

    it("pause stops further poll cycles", async () => {
      addMessagesFolder();
      const socket = createSocket({ pollIntervalInMs: 50 });
      await connectSocket(socket);

      const batches: DriveMessage[][] = [];
      socket.onReceive((messages) => batches.push(messages));
      socket.start();

      await new Promise((resolve) => setTimeout(resolve, 120));
      const countBeforePause = batches.length;
      expect(countBeforePause).toBeGreaterThan(0);

      socket.pause();
      expect(socket.isRunning).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(batches.length).toBe(countBeforePause);
    });

    it("start resumes polling after pause", async () => {
      addMessagesFolder();
      const socket = createSocket({ pollIntervalInMs: 50 });
      await connectSocket(socket);

      const batches: DriveMessage[][] = [];
      socket.onReceive((messages) => batches.push(messages));
      socket.start();

      await new Promise((resolve) => setTimeout(resolve, 80));
      socket.pause();
      const countWhilePaused = batches.length;

      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(batches.length).toBe(countWhilePaused);

      socket.start();
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(batches.length).toBeGreaterThan(countWhilePaused);
    });

    it("does not spawn duplicate poll loops on repeated start", async () => {
      addMessagesFolder();
      const socket = createSocket({ pollIntervalInMs: 200 });
      await connectSocket(socket);
      socket.onReceive(() => {});

      const requestCountBefore = drive.requests.length;
      socket.start();
      socket.start();
      socket.start();

      await new Promise((resolve) => setTimeout(resolve, 250));

      const pollListRequests = drive.requests
        .slice(requestCountBefore)
        .filter(
          ({ method, url }) => method === "GET" && url.includes("/files?"),
        );
      expect(pollListRequests.length).toBeLessThanOrEqual(2);
    });

    it("emits all downloaded files newest-first in one callback", async () => {
      const folder = addMessagesFolder();
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

      const socket = createSocket({ pollIntervalInMs: 200 });
      await connectSocket(socket);

      const batches: DriveMessage[][] = [];
      socket.onReceive((messages) => batches.push(messages));
      socket.start();

      await new Promise((resolve) => setTimeout(resolve, 350));

      const latestBatch = batches.at(-1);
      expect(latestBatch?.map((message) => message.id)).toEqual([
        "newer",
        "older",
      ]);
      expect(
        latestBatch?.every((message) => message.fileBlob instanceof Blob),
      ).toBe(true);
    });

    it("includes failed downloads as error messages in the batch", async () => {
      const folder = addMessagesFolder();
      drive.addFile({
        id: "ok",
        name: "ok.json",
        createdTime: "2026-01-02T00:00:00.000Z",
        parentId: folder.id,
        fileBlob: new Blob(["ok"]),
      });
      drive.addFile({
        id: "bad",
        name: "bad.json",
        createdTime: "2026-01-01T00:00:00.000Z",
        parentId: folder.id,
        fileBlob: new Blob(["bad"]),
      });
      drive.failDownloadIds.add("bad");

      const socket = createSocket({ pollIntervalInMs: 200 });
      await connectSocket(socket);

      const batches: DriveMessage[][] = [];
      socket.onReceive((messages) => batches.push(messages));
      socket.start();

      await new Promise((resolve) => setTimeout(resolve, 350));

      const latestBatch = batches.at(-1);
      expect(latestBatch?.map((message) => message.id)).toEqual(["ok", "bad"]);
      expect(
        latestBatch?.find((message) => message.id === "ok")?.isError,
      ).toBeUndefined();
      expect(latestBatch?.find((message) => message.id === "bad")).toEqual({
        id: "bad",
        name: "bad.json",
        fileBlob: expect.any(Blob),
        isError: true,
      });
    });

    it("renews expired tokens during polling without user interaction", async () => {
      let silentRequestCount = 0;
      clearGoogleOAuthMock();
      installGoogleOAuthMock({
        expiresIn: 61,
        onTokenRequest: (config) => {
          if (config?.prompt === "none") silentRequestCount += 1;
        },
      });

      const socket = createSocket({ pollIntervalInMs: 100 });
      await connectSocket(socket);
      drive.addFolder({
        id: "folder-1",
        name: "messages",
        parentId: "appDataFolder",
      });

      await new Promise((resolve) => setTimeout(resolve, 1_100));

      const batches: DriveMessage[][] = [];
      socket.onReceive((messages) => batches.push(messages));
      socket.start();

      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(silentRequestCount).toBeGreaterThan(0);
      expect(batches.length).toBeGreaterThan(0);
    });

    it("stops polling after disconnect", async () => {
      const socket = createSocket({ pollIntervalInMs: 50 });
      await connectSocket(socket);
      drive.addFolder({
        id: "folder-1",
        name: "messages",
        parentId: "appDataFolder",
      });

      const batches: DriveMessage[][] = [];
      socket.onReceive((messages) => batches.push(messages));
      socket.start();

      await new Promise((resolve) => setTimeout(resolve, 80));
      const countBeforeDisconnect = batches.length;
      await socket.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(batches.length).toBe(countBeforeDisconnect);
    });

    it("waits full pollIntervalInMs after a cycle completes before polling again", async () => {
      const pollIntervalInMs = 80;
      drive.listDelayMs = 120;

      const socket = createSocket({ pollIntervalInMs });
      await connectSocket(socket);
      drive.addFolder({
        id: "folder-1",
        name: "messages",
        parentId: "appDataFolder",
      });

      const callbackTimes: number[] = [];
      socket.onReceive(() => callbackTimes.push(Date.now()));
      socket.start();

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

      const folder = addMessagesFolder();
      drive.addFile({
        id: "file-1",
        name: "slow.json",
        parentId: folder.id,
        fileBlob: new Blob(["slow"]),
      });

      const socket = createSocket({ pollIntervalInMs });
      await connectSocket(socket);

      const callbackTimes: number[] = [];
      socket.onReceive(() => callbackTimes.push(Date.now()));
      socket.start();

      await new Promise((resolve) => setTimeout(resolve, 700));

      expect(callbackTimes.length).toBeGreaterThanOrEqual(2);
      const gapBetweenCallbacks = callbackTimes[1]! - callbackTimes[0]!;
      expect(gapBetweenCallbacks).toBeGreaterThanOrEqual(
        drive.downloadDelayMs + pollIntervalInMs - 40,
      );
    });

    it("does not make drive api calls between poll cycles", async () => {
      const pollIntervalInMs = 500;
      let receiveCount = 0;

      const socket = createSocket({ pollIntervalInMs });
      await connectSocket(socket);
      drive.addFolder({
        id: "folder-1",
        name: "messages",
        parentId: "appDataFolder",
      });

      socket.onReceive(() => {
        receiveCount += 1;
      });
      socket.start();

      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (receiveCount >= 1) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      });

      const countAfterFirstCycle = drive.requests.length;
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(drive.requests.length).toBe(countAfterFirstCycle);

      await new Promise((resolve) => setTimeout(resolve, pollIntervalInMs));
      expect(drive.requests.length).toBeGreaterThan(countAfterFirstCycle);
    });
    it("does not prune during poll cycles", async () => {
      const socket = createSocket({ maxFiles: 1, pollIntervalInMs: 200 });
      await connectSocket(socket);

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

      socket.onReceive(() => {});
      socket.start();

      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(drive.files.has("keep")).toBe(true);
      expect(drive.files.has("drop")).toBe(true);
      expect(drive.requests.some(({ method }) => method === "DELETE")).toBe(
        false,
      );
    });
  });

  describe("delete", () => {
    it("deletes a message by id", async () => {
      const folder = addMessagesFolder();
      const file = drive.addFile({
        id: "msg-1",
        name: "remove.json",
        parentId: folder.id,
      });

      const socket = createSocket();
      await connectSocket(socket);

      await socket.delete(file.id);

      expect(drive.files.has("msg-1")).toBe(false);
      expect(
        drive.requests.some(
          ({ method, url }) =>
            method === "DELETE" && url.includes("/files/msg-1"),
        ),
      ).toBe(true);
    });

    it("rejects when not authenticated", async () => {
      clearGoogleOAuthMock();
      installGoogleOAuthMock({ silentFails: true, loginFails: true });

      const socket = createSocket({ pollIntervalInMs: 50_000 });

      await expect(socket.connect()).rejects.toBeInstanceOf(
        NotAuthenticatedError,
      );
    });
  });

  describe("prune", () => {
    it("deletes oldest files beyond maxFiles after push", async () => {
      const folder = addMessagesFolder();
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

      const socket = createSocket({ maxFiles: 1, pollIntervalInMs: 50_000 });
      await connectSocket(socket);

      await socket.push(new Blob(["{}"]), {
        mimeType: "application/json",
        fileName: "trigger.json",
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(drive.files.has("keep")).toBe(true);
      expect(drive.files.has("drop")).toBe(false);
    });

    it("returns from push before background prune finishes", async () => {
      drive.folderContentsListDelayMs = 200;

      const folder = addMessagesFolder();
      drive.addFile({
        id: "older",
        createdTime: "2026-01-01T00:00:00.000Z",
        parentId: folder.id,
      });

      const socket = createSocket({ maxFiles: 1, pollIntervalInMs: 50_000 });
      await connectSocket(socket);

      await socket.push(new Blob(["{}"]), {
        mimeType: "application/json",
        fileName: "newer.json",
      });

      expect(drive.files.has("older")).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(drive.files.has("older")).toBe(false);
    });
  });
});
