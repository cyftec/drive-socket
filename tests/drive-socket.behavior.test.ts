import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
} from "bun:test";
import {
  InvalidMimeError,
  MessageExistsError,
  NotAuthenticatedError,
} from "../src/errors/index.ts";
import { DriveSocket } from "../src/index.ts";
import { DRIVE_API, DRIVE_APPDATA_SCOPE } from "../src/google/constants.ts";
import { clearGoogleOAuthMock, installGoogleOAuthMock } from "./mocks/google.ts";
import { DriveApiFixture } from "./mocks/drive-api.ts";

const FIXED_FILE_NAME = "msg-20260101T000000Z-abcdefab.json";
const BASE_QUERY = "name contains 'msg-' and trashed=false";

function listQueryFromUrl(url: string): string | null {
  return new URL(url).searchParams.get("q");
}

function listQueries(drive: DriveApiFixture): string[] {
  return drive.requests
    .filter(({ url }) => url.startsWith(DRIVE_API) && url.includes("q="))
    .map(({ url }) => listQueryFromUrl(url) ?? "");
}

describe("DriveSocket", () => {
  let drive: DriveApiFixture;
  let restoreFetch: () => void;

  beforeEach(() => {
    drive = new DriveApiFixture();
    installGoogleOAuthMock();
    restoreFetch = drive.installFetch();
  });

  afterEach(() => {
    restoreFetch();
    clearGoogleOAuthMock();
  });

  function installDeterministicFileNameMocks(): void {
    spyOn(crypto, "randomUUID").mockReturnValue(
      "abcdefab-0000-4000-8000-000000000000",
    );
    spyOn(Date.prototype, "toISOString").mockReturnValue(
      "2026-01-01T00:00:00.000Z",
    );
  }

  describe("auth", () => {
    it("starts unauthenticated", () => {
      const socket = new DriveSocket({ clientId: "client-id" });
      expect(socket.isAuthenticated()).toBe(false);
    });

    it("connect stores an access token", async () => {
      const socket = new DriveSocket({ clientId: "client-id" });
      let capturedScope = "";

      clearGoogleOAuthMock();
      installGoogleOAuthMock({
        onInit: (config) => {
          capturedScope = config.scope;
        },
      });

      await socket.connect();

      expect(socket.isAuthenticated()).toBe(true);
      expect(capturedScope).toBe(DRIVE_APPDATA_SCOPE);
    });

    it("disconnect clears the access token", async () => {
      const socket = new DriveSocket({ clientId: "client-id" });
      await socket.connect();
      await socket.disconnect();
      expect(socket.isAuthenticated()).toBe(false);
    });
  });

  describe("push", () => {
    afterEach(() => {
      spyOn(crypto, "randomUUID").mockRestore();
      spyOn(Date.prototype, "toISOString").mockRestore();
    });

    beforeEach(() => {
      installDeterministicFileNameMocks();
    });

    it("rejects unsupported mime types", async () => {
      const socket = new DriveSocket({ clientId: "client-id" });
      await socket.connect();

      await expect(
        socket.push(new Blob(["x"]), { mimeType: "text/html" }),
      ).rejects.toBeInstanceOf(InvalidMimeError);
    });

    it("rejects when not authenticated", async () => {
      const socket = new DriveSocket({ clientId: "client-id" });

      await expect(
        socket.push(new Blob(["{}"]), { mimeType: "application/json" }),
      ).rejects.toBeInstanceOf(NotAuthenticatedError);
    });

    it("rejects when the target file name already exists", async () => {
      const socket = new DriveSocket({ clientId: "client-id" });
      await socket.connect();
      drive.addFile({ name: FIXED_FILE_NAME });

      await expect(
        socket.push(new Blob(["{}"]), { mimeType: "application/json" }),
      ).rejects.toBeInstanceOf(MessageExistsError);
    });

    it("uploads and returns a file message", async () => {
      const socket = new DriveSocket({ clientId: "client-id" });
      await socket.connect();
      const fileBlob = new Blob(['{"hello":"world"}'], {
        type: "application/json",
      });

      const message = await socket.push(fileBlob, {
        mimeType: "application/json",
      });

      expect(message.fileBlob).toBe(fileBlob);
      expect(message.mimeType).toBe("application/json");
      expect(message.name).toBe(FIXED_FILE_NAME);
      expect(
        drive.requests.some(
          ({ method, url }) =>
            method === "POST" && url.includes("uploadType=multipart"),
        ),
      ).toBe(true);
    });

    it("generates msg-prefixed file names with a timestamp and extension", async () => {
      spyOn(crypto, "randomUUID").mockRestore();
      spyOn(Date.prototype, "toISOString").mockRestore();

      const socket = new DriveSocket({ clientId: "client-id" });
      await socket.connect();

      const message = await socket.push(new Blob(["{}"]), {
        mimeType: "application/json",
      });

      expect(message.name).toMatch(/^msg-\d{8}T\d{6}Z-[a-f0-9]{8}\.json$/);
    });

    it("requests configured metadata fields on upload", async () => {
      const socket = new DriveSocket({ clientId: "client-id" }, ["md5Checksum"]);
      await socket.connect();

      await socket.push(new Blob(["{}"]), { mimeType: "application/json" });

      const uploadRequest = drive.requests.find(
        ({ method, url }) =>
          method === "POST" && url.includes("uploadType=multipart"),
      );
      expect(uploadRequest?.url).toContain(
        "fields=id,name,createdTime,mimeType,size,md5Checksum",
      );
    });
  });

  describe("receive", () => {
    it("returns metadata without downloading file blobs", async () => {
      const socket = new DriveSocket({ clientId: "client-id" });
      await socket.connect();
      drive.addFile({
        id: "older",
        name: "msg-older.json",
        createdTime: "2026-01-01T00:00:00.000Z",
      });
      drive.addFile({
        id: "newer",
        name: "msg-newer.json",
        createdTime: "2026-01-02T00:00:00.000Z",
      });

      const metadata = await socket.receive({
        as: "file-message-metadata",
        limit: 1,
      });

      expect(metadata).toHaveLength(1);
      expect(metadata[0]?.id).toBe("newer");
      expect(
        drive.requests.some(({ url }) => url.includes("alt=media")),
      ).toBe(false);
    });

    it("downloads file blobs in file-message mode", async () => {
      const socket = new DriveSocket({ clientId: "client-id" });
      await socket.connect();
      const fileBlob = new Blob(["payload"], { type: "application/json" });
      drive.addFile({
        id: "file-42",
        name: "msg-42.json",
        createdTime: "2026-01-03T00:00:00.000Z",
        fileBlob,
      });

      const [message] = await socket.receive({
        as: "file-message",
        limit: 1,
      });

      expect(message?.id).toBe("file-42");
      expect(await message?.fileBlob.text()).toBe("payload");
    });

    it("paginates through metadata collection", async () => {
      const socket = new DriveSocket({ clientId: "client-id" });
      await socket.connect();
      drive.addFile({ id: "a", createdTime: "2026-01-04T00:00:00.000Z" });
      drive.addFile({ id: "b", createdTime: "2026-01-03T00:00:00.000Z" });
      drive.addFile({ id: "c", createdTime: "2026-01-02T00:00:00.000Z" });

      const metadata = await socket.receive({ as: "file-message-metadata" });

      expect(metadata.map((file) => file.id)).toEqual(["a", "b", "c"]);
      expect(
        drive.requests.filter(({ url }) => url.includes("pageToken=page-2")),
      ).toHaveLength(1);
    });

    it("sorts newest first and breaks ties by id", async () => {
      const socket = new DriveSocket({ clientId: "client-id" });
      await socket.connect();
      drive.addFile({
        id: "b",
        createdTime: "2026-01-02T00:00:00.000Z",
      });
      drive.addFile({
        id: "a",
        createdTime: "2026-01-02T00:00:00.000Z",
      });
      drive.addFile({
        id: "c",
        createdTime: "2026-01-01T00:00:00.000Z",
      });

      const metadata = await socket.receive({ as: "file-message-metadata" });

      expect(metadata.map((file) => file.id)).toEqual(["a", "b", "c"]);
    });

    it("uses the base message query when no time filter is set", async () => {
      const socket = new DriveSocket({ clientId: "client-id" });
      await socket.connect();
      drive.addFile({ id: "listed" });

      await socket.receive({ as: "file-message-metadata" });

      expect(listQueries(drive).some((query) => query === BASE_QUERY)).toBe(
        true,
      );
    });

    it("filters with a since time query", async () => {
      const socket = new DriveSocket({ clientId: "client-id" });
      await socket.connect();
      drive.addFile({
        id: "old",
        createdTime: "2026-01-01T00:00:00.000Z",
      });
      drive.addFile({
        id: "new",
        createdTime: "2026-01-05T00:00:00.000Z",
      });

      const since = new Date("2026-01-03T00:00:00.000Z");
      const metadata = await socket.receive({
        as: "file-message-metadata",
        timeQuery: { date: since, relation: "since", includingDate: true },
      });

      expect(metadata.map((file) => file.id)).toEqual(["new"]);
      expect(
        listQueries(drive).some(
          (query) =>
            query ===
            `${BASE_QUERY} and createdTime >= '2026-01-03T00:00:00.000Z'`,
        ),
      ).toBe(true);
    });

    it("filters with an until time query", async () => {
      const socket = new DriveSocket({ clientId: "client-id" });
      await socket.connect();
      drive.addFile({
        id: "old",
        createdTime: "2026-01-01T00:00:00.000Z",
      });
      drive.addFile({
        id: "new",
        createdTime: "2026-01-05T00:00:00.000Z",
      });

      const until = new Date("2026-01-03T00:00:00.000Z");
      const metadata = await socket.receive({
        as: "file-message-metadata",
        timeQuery: { date: until, relation: "until" },
      });

      expect(metadata.map((file) => file.id)).toEqual(["old"]);
      expect(
        listQueries(drive).some(
          (query) =>
            query ===
            `${BASE_QUERY} and createdTime < '2026-01-03T00:00:00.000Z'`,
        ),
      ).toBe(true);
    });
  });

  describe("getById", () => {
    it("returns metadata and file blob for a file id", async () => {
      const socket = new DriveSocket({ clientId: "client-id" });
      await socket.connect();
      const fileBlob = new Blob(["by-id"], { type: "application/json" });
      drive.addFile({ id: "target-id", fileBlob });

      const message = await socket.getById("target-id");

      expect(message.id).toBe("target-id");
      expect(await message.fileBlob.text()).toBe("by-id");
    });

    it("requests configured metadata fields", async () => {
      const socket = new DriveSocket({ clientId: "client-id" }, ["md5Checksum"]);
      await socket.connect();
      drive.addFile({ id: "target-id" });

      await socket.getById("target-id");

      const metadataRequest = drive.requests.find(
        ({ url }) => url.includes("/files/target-id") && url.includes("fields="),
      );
      expect(metadataRequest?.url).toContain(
        "fields=id,name,createdTime,mimeType,size,md5Checksum",
      );
    });
  });

  describe("prune", () => {
    it("keeps the newest N files by count", async () => {
      const socket = new DriveSocket({ clientId: "client-id" });
      await socket.connect();
      drive.addFile({ id: "keep", createdTime: "2026-01-05T00:00:00.000Z" });
      drive.addFile({ id: "drop-1", createdTime: "2026-01-04T00:00:00.000Z" });
      drive.addFile({ id: "drop-2", createdTime: "2026-01-03T00:00:00.000Z" });

      const result = await socket.pruneByCount({ keep: 1 });

      expect(result.deletedCount).toBe(2);
      expect(result.keptCount).toBe(1);
      expect(result.deleted.map((file) => file.id).sort()).toEqual([
        "drop-1",
        "drop-2",
      ]);
      expect(drive.files.has("keep")).toBe(true);
      expect(drive.files.has("drop-1")).toBe(false);
    });

    it("deletes files older than a timestamp", async () => {
      const socket = new DriveSocket({ clientId: "client-id" });
      await socket.connect();
      drive.addFile({ id: "old", createdTime: "2026-01-01T00:00:00.000Z" });
      drive.addFile({ id: "new", createdTime: "2026-01-05T00:00:00.000Z" });

      const result = await socket.pruneBefore({
        before: new Date("2026-01-03T00:00:00.000Z"),
      });

      expect(result.deleted.map((file) => file.id)).toEqual(["old"]);
      expect(drive.files.has("new")).toBe(true);
      expect(
        listQueries(drive).some(
          (query) =>
            query ===
            `${BASE_QUERY} and createdTime < '2026-01-03T00:00:00.000Z'`,
        ),
      ).toBe(true);
    });

    it("supports dry runs without deleting files", async () => {
      const socket = new DriveSocket({ clientId: "client-id" });
      await socket.connect();
      drive.addFile({ id: "old", createdTime: "2026-01-01T00:00:00.000Z" });
      drive.addFile({ id: "new", createdTime: "2026-01-05T00:00:00.000Z" });

      const result = await socket.pruneByCount({ keep: 1, dryRun: true });

      expect(result.deletedCount).toBe(1);
      expect(drive.files.has("old")).toBe(true);
      expect(drive.requests.some(({ method }) => method === "DELETE")).toBe(
        false,
      );
    });

    it("rejects negative keep counts", async () => {
      const socket = new DriveSocket({ clientId: "client-id" });
      await socket.connect();

      await expect(socket.pruneByCount({ keep: -1 })).rejects.toThrow(
        "keep must be >= 0",
      );
    });
  });
});
