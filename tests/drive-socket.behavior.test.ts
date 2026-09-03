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
import { getOAuthSingleton } from "../src/google/oauth.ts";
import { DriveApiFixture } from "./mocks/drive-api.ts";
import {
  DEFAULT_ROOT_PATH,
  defaultDriveSocketConfig,
  ROOT_FOLDER_ID,
} from "./mocks/drive-socket-harness.ts";
import {
  createMockOAuth,
  DRIVE_APPDATA_SCOPE,
  DRIVE_FILE_SCOPE,
  getTestOAuth,
  installLocalStorageMock,
  TOKEN_KEY,
  type GoogleOAuth,
} from "./mocks/oauth-harness.ts";
import {
  clearGoogleOAuthMock,
  installGoogleOAuthMock,
} from "./mocks/google.ts";

describe("DriveSocket", () => {
  let drive: DriveApiFixture;
  let restoreFetch: () => void;
  let localStorageMock: { storage: Map<string, string> };
  let oauth: GoogleOAuth;
  const openSockets: DriveSocket[] = [];

  function seedRootPath(rootPath = DEFAULT_ROOT_PATH) {
    const name = rootPath.split("/").at(-1)!;
    return drive.addFolder({
      id: ROOT_FOLDER_ID,
      name,
      parentId: "appDataFolder",
    });
  }

  function createSocket(
    overrides: Partial<DriveSocketConfig> = {},
  ): DriveSocket {
    const socket = new DriveSocket(defaultDriveSocketConfig(overrides), oauth);
    openSockets.push(socket);
    return socket;
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
            defaultDriveSocketConfig({ pollIntervalInMs: 0 }),
            createMockOAuth(DRIVE_APPDATA_SCOPE),
          ),
      ).toThrow("pollIntervalInMs must be > 0");
    });

    it("rejects negative maxFiles", () => {
      expect(
        () =>
          new DriveSocket(
            defaultDriveSocketConfig({ maxFiles: -1 }),
            createMockOAuth(DRIVE_APPDATA_SCOPE),
          ),
      ).toThrow("maxFiles must be >= 0");
    });

    it("rejects empty rootPath", () => {
      expect(
        () =>
          new DriveSocket(
            defaultDriveSocketConfig({ rootPath: "" }),
            createMockOAuth(DRIVE_APPDATA_SCOPE),
          ),
      ).toThrow("rootPath must not be empty");
    });
  });

  describe("clientType", () => {
    it("single-tenant uses appDataFolder space", async () => {
      seedRootPath();
      const socket = createSocket({
        clientType: "single-tenant",
        rootPath: DEFAULT_ROOT_PATH,
      });
      await connectSocket(socket);

      await socket.push(new Blob(["{}"]), {
        mimeType: "application/json",
        fileName: "tenant.json",
      });

      expect(
        drive.requests.some(
          (request) =>
            request.method === "GET" &&
            request.url.includes("spaces=appDataFolder"),
        ),
      ).toBe(true);
    });

    it("multi-tenant uses drive space", async () => {
      const multiTenantOAuth = createMockOAuth(DRIVE_FILE_SCOPE);
      const socket = new DriveSocket(
        defaultDriveSocketConfig({
          clientType: "multi-tenant",
          rootPath: "shared-sync",
        }),
        multiTenantOAuth,
      );
      openSockets.push(socket);
      await socket.connect();

      await socket.push(new Blob(["{}"]), {
        mimeType: "application/json",
        fileName: "sync.json",
      });

      expect(
        drive.requests.some(
          (request) =>
            request.method === "GET" && request.url.includes("spaces=drive"),
        ),
      ).toBe(true);

      const rootFolder = [...drive.files.values()].find(
        (file) => file.name === "shared-sync",
      );
      expect(rootFolder?.parentId).toBe("root");
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
      await connectSocket(socket);

      const raw = localStorageMock.storage.get(TOKEN_KEY);
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!).accessToken).toBe("stored-access");
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

    it("connect resolves rootPath after authenticate", async () => {
      seedRootPath();
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
      expect(JSON.parse(raw!).accessToken).toBe("test-access-token");
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

    it("uploads into configured rootPath", async () => {
      const rootFolder = seedRootPath();
      const socket = createSocket();
      await connectSocket(socket);

      await socket.push(new Blob(['{"hello":"world"}']), {
        mimeType: "application/json",
        fileName: "hello.json",
      });

      const uploaded = [...drive.files.values()].find(
        (file) => file.name === "hello.json",
      );
      expect(uploaded?.parentId).toBe(rootFolder.id);
      expect(
        drive.requests.some(
          ({ method, url }) =>
            method === "POST" && url.includes("uploadType=multipart"),
        ),
      ).toBe(true);
    });

    it("rejects duplicate file names in folder", async () => {
      const rootFolder = seedRootPath();
      drive.addFile({ name: "dup.json", parentId: rootFolder.id });

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
      expect(createSocket().isRunning).toBe(false);
    });

    it("rejects start before connect", () => {
      const socket = createSocket();
      socket.onReceive(() => {});
      expect(() => socket.start()).toThrow(
        "Not connected. Call connect() first.",
      );
    });

    it("rejects start without onReceive", async () => {
      seedRootPath();
      const socket = createSocket();
      await connectSocket(socket);
      expect(() => socket.start()).toThrow(
        "No receive callback registered. Call onReceive() first.",
      );
    });

    it("rejects start after disconnect", async () => {
      seedRootPath();
      const socket = createSocket();
      await connectSocket(socket);
      socket.onReceive(() => {});
      await socket.disconnect();
      expect(() => socket.start()).toThrow(
        "Not connected. Call connect() first.",
      );
    });

    it("does not poll until connected and start is called", async () => {
      seedRootPath();
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
      seedRootPath();
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
      seedRootPath();
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
      seedRootPath();
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
      const rootFolder = seedRootPath();
      drive.addFile({
        id: "older",
        name: "older.json",
        createdTime: "2026-01-01T00:00:00.000Z",
        parentId: rootFolder.id,
        fileBlob: new Blob(["older"]),
      });
      drive.addFile({
        id: "newer",
        name: "newer.json",
        createdTime: "2026-01-02T00:00:00.000Z",
        parentId: rootFolder.id,
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
      const rootFolder = seedRootPath();
      drive.addFile({
        id: "ok",
        name: "ok.json",
        createdTime: "2026-01-02T00:00:00.000Z",
        parentId: rootFolder.id,
        fileBlob: new Blob(["ok"]),
      });
      drive.addFile({
        id: "bad",
        name: "bad.json",
        createdTime: "2026-01-01T00:00:00.000Z",
        parentId: rootFolder.id,
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

      const callbackTimes: number[] = [];
      socket.onReceive(() => callbackTimes.push(Date.now()));
      socket.start();

      await new Promise((resolve) => setTimeout(resolve, 700));

      expect(callbackTimes.length).toBeGreaterThanOrEqual(2);
      expect(callbackTimes[1]! - callbackTimes[0]!).toBeGreaterThanOrEqual(
        drive.listDelayMs + pollIntervalInMs - 40,
      );
    });

    it("waits full pollIntervalInMs after downloads finish before polling again", async () => {
      const pollIntervalInMs = 80;
      drive.downloadDelayMs = 120;

      const rootFolder = seedRootPath();
      drive.addFile({
        id: "file-1",
        name: "slow.json",
        parentId: rootFolder.id,
        fileBlob: new Blob(["slow"]),
      });

      const socket = createSocket({ pollIntervalInMs });
      await connectSocket(socket);

      const callbackTimes: number[] = [];
      socket.onReceive(() => callbackTimes.push(Date.now()));
      socket.start();

      await new Promise((resolve) => setTimeout(resolve, 700));

      expect(callbackTimes.length).toBeGreaterThanOrEqual(2);
      expect(callbackTimes[1]! - callbackTimes[0]!).toBeGreaterThanOrEqual(
        drive.downloadDelayMs + pollIntervalInMs - 40,
      );
    });

    it("does not make drive api calls between poll cycles", async () => {
      const pollIntervalInMs = 500;
      let receiveCount = 0;

      const socket = createSocket({ pollIntervalInMs });
      await connectSocket(socket);

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
      const rootFolder = seedRootPath();
      drive.addFile({
        id: "keep",
        createdTime: "2026-01-05T00:00:00.000Z",
        parentId: rootFolder.id,
      });
      drive.addFile({
        id: "drop",
        createdTime: "2026-01-01T00:00:00.000Z",
        parentId: rootFolder.id,
      });

      const socket = createSocket({ maxFiles: 1, pollIntervalInMs: 200 });
      await connectSocket(socket);
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
      const rootFolder = seedRootPath();
      const file = drive.addFile({
        id: "msg-1",
        name: "remove.json",
        parentId: rootFolder.id,
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

    it("rejects connect when not authenticated", async () => {
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
      const rootFolder = seedRootPath();
      drive.addFile({
        id: "keep",
        createdTime: "2026-01-05T00:00:00.000Z",
        parentId: rootFolder.id,
      });
      drive.addFile({
        id: "drop",
        createdTime: "2026-01-01T00:00:00.000Z",
        parentId: rootFolder.id,
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

      const rootFolder = seedRootPath();
      drive.addFile({
        id: "older",
        createdTime: "2026-01-01T00:00:00.000Z",
        parentId: rootFolder.id,
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
