import { describe, expect, it } from "vitest";
import { compareNatural, isExternalHref, slugify, splitHref, toOutputRelPath } from "./util.js";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("My Secure Spec")).toBe("my-secure-spec");
  });
  it("handles Japanese-only input without producing an empty slug", () => {
    expect(slugify("社内仕様書")).toBe("site");
  });
  it("truncates to 63 chars", () => {
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(63);
  });
});

describe("compareNatural", () => {
  it("sorts numeric prefixes naturally (10 after 2)", () => {
    const arr = ["10-x.md", "2-x.md", "1-x.md"];
    arr.sort(compareNatural);
    expect(arr).toEqual(["1-x.md", "2-x.md", "10-x.md"]);
  });
});

describe("splitHref", () => {
  it("splits path/query/hash", () => {
    expect(splitHref("a/b.md?x=1#sec")).toEqual({ pathPart: "a/b.md", query: "?x=1", hash: "#sec" });
  });
  it("handles fragment-only href", () => {
    expect(splitHref("#sec")).toEqual({ pathPart: "", query: "", hash: "#sec" });
  });
});

describe("isExternalHref", () => {
  it("detects http(s) and protocol-relative URLs", () => {
    expect(isExternalHref("https://example.com")).toBe(true);
    expect(isExternalHref("//example.com")).toBe(true);
    expect(isExternalHref("mailto:a@example.com")).toBe(true);
  });
  it("does not flag relative paths", () => {
    expect(isExternalHref("../spec/auth.md")).toBe(false);
    expect(isExternalHref("images/flow.png")).toBe(false);
  });
});

describe("toOutputRelPath", () => {
  it("converts .md to .html preserving directory structure", () => {
    expect(toOutputRelPath("docs/spec/auth.md")).toBe("docs/spec/auth.html");
  });
  it("maps README.md to index.html", () => {
    expect(toOutputRelPath("docs/spec/README.md")).toBe("docs/spec/index.html");
  });
  it("maps root-level README.md to index.html with no directory prefix", () => {
    expect(toOutputRelPath("README.md")).toBe("index.html");
  });
});
