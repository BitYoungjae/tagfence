import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BLOCKED_INJECTION_MARKER,
  TagfenceError,
  sanitize,
  sanitizeReservedTagPrefixText,
  validatePrefix,
} from "../dist/index.js";

describe("sanitize", () => {
  it("replaces exact reserved prefixes", () => {
    assert.equal(
      sanitize("hello <engine:inbox>world</engine:inbox>", {
        prefix: "engine:",
      }),
      `hello <${BLOCKED_INJECTION_MARKER}inbox>world</${BLOCKED_INJECTION_MARKER}inbox>`,
    );
  });

  it("supports custom replacements", () => {
    assert.equal(
      sanitize("hello <engine:inbox>", {
        prefix: "engine:",
        replacement: "[redacted]",
      }),
      "hello <[redacted]inbox>",
    );
  });

  it("returns the original text when there is no match", () => {
    const text = "hello <user:inbox>world</user:inbox>";
    assert.equal(sanitize(text, { prefix: "engine:" }), text);
  });

  it("matches mixed case prefixes", () => {
    assert.equal(
      sanitize("hello <Engine:inbox>", { prefix: "engine:" }),
      `hello <${BLOCKED_INJECTION_MARKER}inbox>`,
    );
  });

  it("matches fullwidth characters", () => {
    assert.equal(
      sanitize("hello <ｅｎｇｉｎｅ：inbox>", { prefix: "engine:" }),
      `hello <${BLOCKED_INJECTION_MARKER}inbox>`,
    );
  });

  it("matches zero-width character insertions", () => {
    assert.equal(
      sanitize("hello <e\u200cn\u200cg\u200ci\u200cn\u200ce\u200c:inbox>", {
        prefix: "engine:",
      }),
      `hello <${BLOCKED_INJECTION_MARKER}inbox>`,
    );
  });

  it("matches bidi control insertions", () => {
    assert.equal(
      sanitize("hello <en\u202e\u202egine:inbox>", { prefix: "engine:" }),
      `hello <${BLOCKED_INJECTION_MARKER}inbox>`,
    );
  });

  it("matches combining mark insertions", () => {
    assert.equal(
      sanitize("hello <e\u0301n\u0301g\u0301i\u0301n\u0301e\u0301:inbox>", {
        prefix: "engine:",
      }),
      `hello <${BLOCKED_INJECTION_MARKER}inbox>`,
    );
  });

  it("matches separator insertions", () => {
    assert.equal(
      sanitize("hello <e n-g_i.n/e:inbox>", { prefix: "engine:" }),
      `hello <${BLOCKED_INJECTION_MARKER}inbox>`,
    );
  });

  it("matches known homoglyph substitutions", () => {
    assert.equal(
      sanitize("hello <еngіnе:inbox>", { prefix: "engine:" }),
      `hello <${BLOCKED_INJECTION_MARKER}inbox>`,
    );
  });

  it("matches prefixes after malformed surrogate code units", () => {
    assert.equal(
      sanitize("\uD800engine:inbox", { prefix: "engine:" }),
      `\uD800${BLOCKED_INJECTION_MARKER}inbox`,
    );
  });

  it("keeps valid surrogate pairs on the Unicode matching path", () => {
    assert.equal(
      sanitize("hello <\uD835\uDC52ngine:inbox>", { prefix: "engine:" }),
      `hello <${BLOCKED_INJECTION_MARKER}inbox>`,
    );
  });

  it("preserves the low-level tagPrefix API", () => {
    assert.equal(
      sanitizeReservedTagPrefixText("hello <sipduk:context>", {
        tagPrefix: "sipduk:",
      }),
      `hello <${BLOCKED_INJECTION_MARKER}context>`,
    );
  });
});

describe("validatePrefix", () => {
  it("accepts lowercase ASCII prefixes ending in one colon", () => {
    assert.equal(validatePrefix("engine-2:"), "engine-2:");
  });

  it("rejects invalid prefixes", () => {
    assert.throws(() => validatePrefix("Engine:"), TagfenceError);
    assert.throws(() => validatePrefix("engine"), TagfenceError);
    assert.throws(() => validatePrefix("engine::"), TagfenceError);
  });

  it("rejects invalid options", () => {
    assert.throws(() => sanitize("hello", null), TagfenceError);
    assert.throws(
      () => sanitize("hello", { prefix: "engine:", replacement: "" }),
      TagfenceError,
    );
  });
});
