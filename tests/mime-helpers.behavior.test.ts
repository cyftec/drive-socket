import { describe, expect, it } from "bun:test";
import {
  isValidMimeType,
  mimeToExtension,
} from "../src/google/mime-helpers.ts";

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
