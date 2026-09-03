import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  DriveAmbiguousPathError,
  DriveScopeError,
} from "../src/errors/index.ts";
import { GoogleDriveFolder } from "../src/google/drive-folder.ts";
import { DriveApiFixture } from "./mocks/drive-api.ts";
import {
  createMockOAuth,
  DRIVE_APPDATA_SCOPE,
  DRIVE_FILE_SCOPE,
} from "./mocks/oauth-harness.ts";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

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

  describe("getFolderHandle scope validation", () => {
    it("throws DriveScopeError when appDataFolder scope is missing", async () => {
      await expect(
        GoogleDriveFolder.getFolderHandle({
          oauth: createMockOAuth(DRIVE_FILE_SCOPE),
          space: "appDataFolder",
          rootFolderPath: "my-app",
        }),
      ).rejects.toThrow(DriveScopeError);
    });

    it("accepts drive.file scope for drive space", async () => {
      await expect(
        GoogleDriveFolder.getFolderHandle({
          oauth: createMockOAuth(DRIVE_FILE_SCOPE),
          space: "drive",
          rootFolderPath: "my-app",
        }),
      ).resolves.toBeInstanceOf(GoogleDriveFolder);
    });

    it("throws DriveScopeError when drive space has only appDataFolder scope", async () => {
      await expect(
        GoogleDriveFolder.getFolderHandle({
          oauth: createMockOAuth(DRIVE_APPDATA_SCOPE),
          space: "drive",
          rootFolderPath: "my-app",
        }),
      ).rejects.toThrow(DriveScopeError);
    });
  });

  describe("appDataFolder space", () => {
    const oauth = createMockOAuth(DRIVE_APPDATA_SCOPE);

    it("getFolderHandle creates nested root when absent", async () => {
      await GoogleDriveFolder.getFolderHandle({
        oauth,
        space: "appDataFolder",
        rootFolderPath: "my-app/inbox",
      });

      const created = [...drive.files.values()].filter(
        (file) => file.mimeType === FOLDER_MIME_TYPE,
      );
      expect(created.map((file) => file.name).sort()).toEqual([
        "inbox",
        "my-app",
      ]);
      expect(created.find((file) => file.name === "my-app")?.parentId).toBe(
        "appDataFolder",
      );
    });

    it("getFolderHandle reuses existing root folders", async () => {
      const existing = drive.addFolder({
        id: "existing-root",
        name: "my-app",
        parentId: "appDataFolder",
      });

      await GoogleDriveFolder.getFolderHandle({
        oauth,
        space: "appDataFolder",
        rootFolderPath: "my-app",
      });

      const folders = [...drive.files.values()].filter(
        (file) =>
          file.mimeType === FOLDER_MIME_TYPE && file.name === "my-app",
      );
      expect(folders).toHaveLength(1);
      expect(folders[0]?.id).toBe(existing.id);
    });

    it("files lists only files non-recursively with appDataFolder spaces param", async () => {
      const root = drive.addFolder({
        id: "root-folder",
        name: "my-app",
        parentId: "appDataFolder",
      });
      drive.addFile({ id: "file-1", name: "a.json", parentId: root.id });
      drive.addFolder({ id: "sub-folder", name: "nested", parentId: root.id });
      drive.addFile({
        id: "file-2",
        name: "deep.json",
        parentId: "sub-folder",
      });

      const folder = await GoogleDriveFolder.getFolderHandle({
        oauth,
        space: "appDataFolder",
        rootFolderPath: "my-app",
      });

      expect((await folder.files()).map((file) => file.name)).toEqual([
        "a.json",
      ]);
      expect(
        drive.requests.some(
          (request) =>
            request.method === "GET" &&
            request.url.includes("spaces=appDataFolder"),
        ),
      ).toBe(true);
    });

    it("write, read, exists, and deleteByPath round-trip", async () => {
      const folder = await GoogleDriveFolder.getFolderHandle({
        oauth,
        space: "appDataFolder",
        rootFolderPath: "my-app",
      });

      const fileBlob = new Blob(['{"hello":"world"}'], {
        type: "application/json",
      });
      const saved = await folder.write("hello.json", fileBlob, "application/json");
      expect(saved.name).toBe("hello.json");
      expect(await folder.exists("hello.json")).toBe(true);
      expect(await (await folder.read("hello.json")).text()).toBe(
        '{"hello":"world"}',
      );

      await folder.deleteByPath("hello.json");
      expect(await folder.exists("hello.json")).toBe(false);
    });

    it("write creates missing parent folders on demand", async () => {
      const folder = await GoogleDriveFolder.getFolderHandle({
        oauth,
        space: "appDataFolder",
        rootFolderPath: "my-app",
      });

      await folder.write(
        "archive/2024/data.json",
        new Blob(["{}"], { type: "application/json" }),
        "application/json",
      );

      expect(await folder.exists("archive/2024/data.json")).toBe(true);
    });

    it("mkdir creates nested folders under root", async () => {
      const folder = await GoogleDriveFolder.getFolderHandle({
        oauth,
        space: "appDataFolder",
        rootFolderPath: "my-app",
      });

      await folder.mkdir("outbox/pending");

      const folderNames = [...drive.files.values()]
        .filter((file) => file.mimeType === FOLDER_MIME_TYPE)
        .map((file) => file.name);
      expect(folderNames).toContain("outbox");
      expect(folderNames).toContain("pending");
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

      const folder = await GoogleDriveFolder.getFolderHandle({
        oauth,
        space: "appDataFolder",
        rootFolderPath: "my-app",
      });

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

      await expect(
        GoogleDriveFolder.getFolderHandle({
          oauth,
          space: "appDataFolder",
          rootFolderPath: "my-app/inbox",
        }),
      ).rejects.toThrow(DriveAmbiguousPathError);
    });
  });

  describe("drive space", () => {
    const oauth = createMockOAuth(DRIVE_FILE_SCOPE);

    it("getFolderHandle creates root under My Drive with drive spaces param", async () => {
      await GoogleDriveFolder.getFolderHandle({
        oauth,
        space: "drive",
        rootFolderPath: "shared-sync",
      });

      const created = [...drive.files.values()].find(
        (file) => file.name === "shared-sync",
      );
      expect(created?.parentId).toBe("root");
      expect(
        drive.requests.some(
          (request) =>
            request.method === "GET" && request.url.includes("spaces=drive"),
        ),
      ).toBe(true);
    });

    it("files and write work in drive space separately from appDataFolder", async () => {
      const appDataFolderRoot = drive.addFolder({
        id: "appdata-root",
        name: "my-app",
        parentId: "appDataFolder",
      });
      drive.addFile({
        id: "appdata-file",
        name: "hidden.json",
        parentId: appDataFolderRoot.id,
      });

      const folder = await GoogleDriveFolder.getFolderHandle({
        oauth,
        space: "drive",
        rootFolderPath: "public",
      });

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
