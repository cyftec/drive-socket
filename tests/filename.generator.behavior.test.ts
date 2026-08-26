import { describe, expect, it } from "bun:test";
import { generateMessageFileName } from "../src/drive-socket/utils/new-file-name-generator.ts";

describe("message file name generator", () => {
  it("creates a msg-prefixed name with an extension", () => {
    const fileName = generateMessageFileName("json");
    expect(fileName).toMatch(/^msg-\d{8}T\d{6}Z-[a-f0-9]{8}\.json$/);
  });
});
