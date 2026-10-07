import { describe, expect, it } from "vitest";
import { inAppPath } from "../inAppPath";

describe("inAppPath", () => {
  it.each(["/dashboard", "/campaigns/123?tab=ads", "/", "/social/inbox#top"])(
    "accepts the in-app path %s",
    (link) => {
      expect(inAppPath(link)).toBe(link);
    }
  );

  it.each([
    ["protocol-relative", "//evil.example"],
    ["backslash host", "/\\evil.example"],
    ["absolute URL", "https://evil.example"],
    ["javascript: scheme", "javascript:alert(1)"],
    ["relative path", "dashboard"],
    // The URL parser strips tab/newline, so "/\t/evil" would become "//evil".
    ["tab after slash", "/\t/evil.example"],
    ["newline after slash", "/\n/evil.example"],
    ["empty", ""],
  ])("rejects a %s link", (_label, link) => {
    expect(inAppPath(link)).toBeNull();
  });

  it("rejects null and undefined", () => {
    expect(inAppPath(null)).toBeNull();
    expect(inAppPath(undefined)).toBeNull();
  });
});
