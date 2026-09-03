import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  DriveAmbiguousPathError,
  DriveScopeError,
} from "../src/errors/index.ts";
import {
  GoogleDriveFolder,
} from "../src/google/drive-folder.ts";
import type { GoogleOAuth } from "../src/google/oauth.ts";
import { DriveApiFixture } from "./mocks/drive-api.ts";

const APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

function createMockOAuth(scopes: string): GoogleOAuth {
  return {
    getConfiguredScopes: () => scopes,
    authenticate: async () => {},
    authorizedFetch: (url, init) => fetch(url, init),
  } as GoogleOAuth;
}

describe("GoogleDriveFolder", () => {
  let drive: DriveApiFixture;
  let restoreFetch: () => void;

  beforeEach(() => {
    drive = new DriveApiFixture();
    restoreFetch = drive.installFetch();
  });

  afterEach(() => {
    restoreFetch();
  });

  describe("constructor scope validation", () => {
    it("throws DriveScopeError when appDataFolder scope is missing", () => {
      const oauth = createMockOAuth(DRIVE_FILE_SCOPE);
      expect(
        () =>
          new GoogleDriveFolder({
            oauth,
            space: "appDataFolder",
            rootFolderPath: "my-app",
          }),
      ).toThrow(DriveScopeError);
    });

    it("accepts drive.file scope for drive space", () => {
      const oauth = createMockOAuth(DRIVE_FILE_SCOPE);
      expect(
        () =>
          new GoogleDriveFolder({
            oauth,
            space: "drive",
            rootFolderPath: "my-app",
          }),
      ).not.toThrow();
    });

    it("throws DriveScopeError when drive space has only appDataFolder scope", () => {
      const oauth = createMockOAuth(APPDATA_SCOPE);
      expect(
        () =>
          new GoogleDriveFolder({
            oauth,
            space: "drive",
            rootFolderPath: "my-app",
          }),
      ).toThrow(DriveScopeError);
    });
  });

  describe("appDataFolder space", () => {
    const oauth = createMockOAuth(APPDATA_SCOPE);

    it("connect creates nested root when absent", async () => {
      const folder = new GoogleDriveFolder({
        oauth,
        space: "appDataFolder",
        rootFolderPath: "my-app/inbox",
      });

      await folder.connect();

      const created = [...drive.files.values()].filter(
        (file) => file.mimeType === "application/vnd.google-apps.folder",
      );
      expect(created.map((file) => file.name).sort()).toEqual([
        "inbox",
        "my-app",
      ]);
      expect(created.find((file) => file.name === "my-app")?.parentId).toBe(
        "appDataFolder",
      );
    });

    it("connect reuses existing root folders", async () => {
      const existing = drive.addFolder({
        id: "existing-root",
        name: "my-app",
        parentId: "appDataFolder",
      });

      const folder = new GoogleDriveFolder({
        oauth,
        space: "appDataFolder",
        rootFolderPath: "my-app",
      });

      await folder.connect();

      const folders = [...drive.files.values()].filter(
        (file) =>
          file.mimeType === "application/vnd.google-apps.folder" &&
          file.name === "my-app",
      );
      expect(folders).toHaveLength(1);
      expect(folders[0]?.id).toBe(existing.id);
    });

    it("connect is idempotent", async () => {
      const folder = new GoogleDriveFolder({
        oauth,
        space: "appDataFolder",
        rootFolderPath: "my-app",
      });

      await folder.connect();
      const requestCountAfterFirst = drive.requests.length;
      await folder.connect();
      expect(drive.requests.length).toBe(requestCountAfterFirst);
    });

    it("files lists only files non-recursively with appDataFolder spaces param", async () => {
      const root = drive.addFolder({
        id: "root-folder",
        name: "my-app",
        parentId: "appDataFolder",
      });
      drive.addFile({
        id: "file-1",
        name: "a.json",
        parentId: root.id,
      });
      drive.addFolder({
        id: "sub-folder",
        name: "nested",
        parentId: root.id,
      });
      drive.addFile({
        id: "file-2",
        name: "deep.json",
        parentId: "sub-folder",
      });

      const folder = new GoogleDriveFolder({
        oauth,
        space: "appDataFolder",
        rootFolderPath: "my-app",
      });
      await folder.connect();

      const files = await folder.files();
      expect(files.map((file) => file.name)).toEqual(["a.json"]);

      const listRequest = drive.requests.find(
        (request) =>
          request.method === "GET" && request.url.includes("spaces=appDataFolder"),
      );
      expect(listRequest).toBeDefined();
    });

    it("write, read, exists, and deleteByPath round-trip", async () => {
      const folder = new GoogleDriveFolder({
        oauth,
        space: "appDataFolder",
        rootFolderPath: "my-app",
      });
      await folder.connect();

      const fileBlob = new Blob(['{"hello":"world"}'], {
        type: "application/json",
      });
      const saved = await folder.write("hello.json", fileBlob, "application/json");
      expect(saved.name).toBe("hello.json");
      expect(await folder.exists("hello.json")).toBe(true);

      const downloaded = await folder.read("hello.json");
      expect(await downloaded.text()).toBe('{"hello":"world"}');

      await folder.deleteByPath("hello.json");
      expect(await folder.exists("hello.json")).toBe(false);
    });

    it("write creates missing parent folders on demand", async () => {
      const folder = new GoogleDriveFolder({
        oauth,
        space: "appDataFolder",
        rootFolderPath: "my-app",
      });
      await folder.connect();

      await folder.write(
        "archive/2024/data.json",
        new Blob(["{}"], { type: "application/json" }),
        "application/json",
      );

      expect(await folder.exists("archive/2024/data.json")).toBe(true);
    });

    it("mkdir creates nested folders under root", async () => {
      const folder = new GoogleDriveFolder({
        oauth,
        space: "appDataFolder",
        rootFolderPath: "my-app",
      });
      await folder.connect();

      await folder.mkdir("outbox/pending");

      const folders = [...drive.files.values()].filter(
        (file) => file.mimeType === "application/vnd.google-apps.folder",
      );
      expect(folders.map((file) => file.name).sort()).toContain("outbox");
      expect(folders.map((file) => file.name).sort()).toContain("pending");
    });

    it("deleteById issues a single DELETE without list query", async () => {
      const root = drive.addFolder({
        id: "root-folder",
        name: "my-app",
        parentId: "appDataFolder",
      });
      const file = drive.addFile({
        id: "delete-me",
        name: "temp.json",
        parentId: root.id,
      });

      const folder = new GoogleDriveFolder({
        oauth,
        space: "appDataFolder",
        rootFolderPath: "my-app",
      });
      await folder.connect();

      const requestsBefore = drive.requests.length;
      await folder.deleteById(file.id);
      const newRequests = drive.requests.slice(requestsBefore);

      expect(newRequests).toHaveLength(1);
      expect(newRequests[0]?.method).toBe("DELETE");
      expect(newRequests[0]?.url).toContain("delete-me");
      expect(drive.files.has("delete-me")).toBe(false);
    });

    it("throws DriveAmbiguousPathError for duplicate folder names", async () => {
      const root = drive.addFolder({
        id: "root-folder",
        name: "my-app",
        parentId: "appDataFolder",
      });
      drive.addFolder({ id: "dup-1", name: "inbox", parentId: root.id });
      drive.addFolder({ id: "dup-2", name: "inbox", parentId: root.id });

      const folder = new GoogleDriveFolder({
        oauth,
        space: "appDataFolder",
        rootFolderPath: "my-app/inbox",
      });

      await expect(folder.connect()).rejects.toThrow(DriveAmbiguousPathError);
    });

    it("throws when used before connect", async () => {
      const folder = new GoogleDriveFolder({
        oauth,
        space: "appDataFolder",
        rootFolderPath: "my-app",
      });

      await expect(folder.files()).rejects.toThrow(
        "Not connected. Call connect() first.",
      );
    });
  });

  describe("drive space", () => {
    const oauth = createMockOAuth(DRIVE_FILE_SCOPE);

    it("connect creates root under My Drive with drive spaces param", async () => {
      const folder = new GoogleDriveFolder({
        oauth,
        space: "drive",
        rootFolderPath: "shared-sync",
      });

      await folder.connect();

      const created = [...drive.files.values()].find(
        (file) => file.name === "shared-sync",
      );
      expect(created?.parentId).toBe("root");

      const listRequest = drive.requests.find(
        (request) =>
          request.method === "GET" && request.url.includes("spaces=drive"),
      );
      expect(listRequest).toBeDefined();
    });

    it("files and write work in drive space separately from appData", async () => {
      const appDataRoot = drive.addFolder({
        id: "appdata-root",
        name: "my-app",
        parentId: "appDataFolder",
      });
      drive.addFile({
        id: "appdata-file",
        name: "hidden.json",
        parentId: appDataRoot.id,
      });

      const folder = new GoogleDriveFolder({
        oauth,
        space: "drive",
        rootFolderPath: "public",
      });
      await folder.connect();

      await folder.write(
        "visible.json",
        new Blob(["{}"], { type: "application/json" }),
        "application/json",
      );

      const files = await folder.files();
      expect(files.map((file) => file.name)).toEqual(["visible.json"]);
      expect(files.some((file) => file.name === "hidden.json")).toBe(false);
    });
  });
});
