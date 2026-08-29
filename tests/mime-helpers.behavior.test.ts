import { describe, expect, it } from "bun:test";
import {
  supportedMimeType,
  mimeToExtension,
} from "../src/google/utils/mime-helpers";

describe("mime helpers", () => {
  it("accepts supported mime types", () => {
    expect(supportedMimeType("application/json")).toBe(true);
    expect(mimeToExtension("application/json")).toBe("json");
  });

  it("rejects html, css, and javascript mime types", () => {
    expect(supportedMimeType("text/html")).toBe(false);
    expect(supportedMimeType("text/css")).toBe(false);
    expect(supportedMimeType("text/javascript")).toBe(false);
    expect(supportedMimeType("application/javascript")).toBe(false);
  });
});
