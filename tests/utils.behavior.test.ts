import { describe, expect, it } from "bun:test";
import {
  baseMessageQuery,
  buildBeforeQuery,
  buildReceiveQuery,
} from "../src/drive-socket/utils/query-helpers.ts";
import { sortByCreatedTimeDesc } from "../src/drive-socket/utils/metadata-list-sorter.ts";
import {
  isValidMimeType,
  mimeToExtension,
} from "../src/google/mime-helpers.ts";
import { sampleMetadata } from "./fixtures/metadata.ts";

describe("query helpers", () => {
  it("builds the base message query", () => {
    expect(baseMessageQuery()).toBe("name contains 'msg-' and trashed=false");
  });

  it("adds a before filter", () => {
    const before = new Date("2026-01-15T00:00:00.000Z");
    expect(buildBeforeQuery(before)).toBe(
      "name contains 'msg-' and trashed=false and createdTime < '2026-01-15T00:00:00.000Z'",
    );
  });

  it("adds since and until filters", () => {
    const since = new Date("2026-01-01T00:00:00.000Z");
    const until = new Date("2026-01-31T00:00:00.000Z");

    expect(buildReceiveQuery({ since })).toContain("createdTime >=");
    expect(buildReceiveQuery({ until })).toContain("createdTime <=");
  });
});

describe("metadata list sorter", () => {
  it("sorts newest first and breaks ties by id", () => {
    const sorted = sortByCreatedTimeDesc([
      sampleMetadata({ id: "b", createdTime: "2026-01-01T00:00:00.000Z" }),
      sampleMetadata({ id: "a", createdTime: "2026-01-02T00:00:00.000Z" }),
      sampleMetadata({ id: "c", createdTime: "2026-01-02T00:00:00.000Z" }),
    ]);

    expect(sorted.map((file) => file.id)).toEqual(["a", "c", "b"]);
  });
});

describe("mime helpers", () => {
  it("accepts supported mime types", () => {
    expect(isValidMimeType("application/json")).toBe(true);
    expect(mimeToExtension("application/json")).toBe("json");
  });

  it("rejects html, css, and javascript mime types", () => {
    expect(isValidMimeType("text/html")).toBe(false);
    expect(isValidMimeType("text/css")).toBe(false);
    expect(isValidMimeType("text/javascript")).toBe(false);
    expect(isValidMimeType("application/javascript")).toBe(false);
  });
});
