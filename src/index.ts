export const BLOCKED_INJECTION_MARKER = "[blocked-injection]" as const;

export interface SanitizeOptions {
  /** The reserved prefix to protect, for example "engine:" or "sipduk:". */
  readonly prefix: string;
  /** Replacement text for detected injections. Default: "[blocked-injection]". */
  readonly replacement?: string;
}

export interface ReservedTagPrefixMatchOptions {
  readonly tagPrefix: string;
}

export interface ReservedTagPrefixSanitizerOptions extends ReservedTagPrefixMatchOptions {
  readonly replacement?: string;
}

export class TagfenceError extends Error {
  readonly code = "tagfence_reserved_tag_prefix_invalid";
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "TagfenceError";
  }
}

const RESERVED_TAG_PREFIX_PATTERN = /^[a-z0-9-]+:$/u;
const COMBINING_MARK_PATTERN = /\p{M}/u;
const INSERTED_SEPARATOR_PATTERN = /[\s\p{P}]/u;

export function sanitize(text: string, options: SanitizeOptions): string {
  assertRecord(options, "Tagfence sanitize options");
  const sanitizerOptions: ReservedTagPrefixSanitizerOptions =
    options.replacement === undefined
      ? { tagPrefix: options.prefix }
      : { tagPrefix: options.prefix, replacement: options.replacement };
  return sanitizeReservedTagPrefixText(text, sanitizerOptions);
}

export function validatePrefix(prefix: string): string {
  return validateReservedTagPrefix(prefix);
}

export function validateReservedTagPrefix(prefix: string): string {
  if (typeof prefix !== "string") {
    throw reservedTagPrefixError("Reserved tag prefix must be a string.");
  }
  if (!RESERVED_TAG_PREFIX_PATTERN.test(prefix)) {
    throw reservedTagPrefixError(
      "Reserved tag prefix must contain only ASCII lowercase letters, digits, " +
        "or hyphen, and end with one colon.",
    );
  }
  return prefix;
}

export function sanitizeReservedTagPrefixText(
  text: string,
  options: ReservedTagPrefixSanitizerOptions,
): string {
  if (typeof text !== "string") {
    throw reservedTagPrefixError(
      "Reserved tag prefix sanitizer text must be a string.",
    );
  }
  assertRecord(options, "Reserved tag prefix sanitizer options");

  const tagPrefix = validateReservedTagPrefix(options.tagPrefix);
  const replacement = normalizeReplacement(options.replacement);
  const firstTarget = tagPrefix[0]!;
  let output = "";
  let cursor = 0;
  let matched = false;

  for (let index = 0; index < text.length; ) {
    if (!couldStartMatch(text, index, firstTarget)) {
      index = nextCodePointIndex(text, index);
      continue;
    }

    const match = matchPrefixAt(text, index, tagPrefix, firstTarget);
    if (match === undefined) {
      index = nextCodePointIndex(text, index);
      continue;
    }

    output += text.slice(cursor, match.start);
    output += replacement;
    cursor = match.end;
    index = match.end;
    matched = true;
  }

  if (!matched) return text;
  return output + text.slice(cursor);
}

function couldStartMatch(
  text: string,
  index: number,
  firstTarget: string,
): boolean {
  const codePoint = text.codePointAt(index);
  if (codePoint === undefined) return false;
  if (codePoint <= 0x7f) {
    const charCode =
      codePoint >= 0x41 && codePoint <= 0x5a ? codePoint + 0x20 : codePoint;
    return charCode === firstTarget.charCodeAt(0);
  }
  return normalizeCodePoint(
    text.slice(index, nextCodePointIndex(text, index)),
  ).includes(firstTarget);
}

function matchPrefixAt(
  text: string,
  start: number,
  target: string,
  firstTarget: string,
): { readonly start: number; readonly end: number } | undefined {
  const rawEnd = nextCodePointIndex(text, start);
  const raw = text.slice(start, rawEnd);
  const chars = normalizeCodePoint(raw);
  if (chars.length === 0) return undefined;

  let prefixStartAllowed = true;
  for (let charIndex = 0; charIndex < chars.length; charIndex += 1) {
    const char = chars[charIndex]!;
    if (prefixStartAllowed && char === firstTarget) {
      const end = consumePrefix(text, rawEnd, chars, charIndex, target);
      if (end !== undefined) return { start, end };
    }
    if (!isInsertedSeparator(char)) prefixStartAllowed = false;
  }

  return undefined;
}

function consumePrefix(
  text: string,
  firstRawEnd: number,
  firstChars: string,
  firstCharIndex: number,
  target: string,
): number | undefined {
  let targetIndex = 0;
  const firstResult = consumeNormalizedChars(
    firstChars,
    firstCharIndex,
    target,
    targetIndex,
  );
  if (firstResult === undefined) return undefined;
  targetIndex = firstResult;
  if (targetIndex === target.length) return firstRawEnd;

  for (let index = firstRawEnd; index < text.length; ) {
    const rawEnd = nextCodePointIndex(text, index);
    const raw = text.slice(index, rawEnd);
    const chars = normalizeCodePoint(raw);
    if (chars.length === 0) {
      index = rawEnd;
      continue;
    }

    const nextTargetIndex = consumeNormalizedChars(
      chars,
      0,
      target,
      targetIndex,
    );
    if (nextTargetIndex === undefined) return undefined;
    targetIndex = nextTargetIndex;
    if (targetIndex === target.length) return rawEnd;
    index = rawEnd;
  }

  return undefined;
}

function consumeNormalizedChars(
  chars: string,
  start: number,
  target: string,
  initialTargetIndex: number,
): number | undefined {
  let targetIndex = initialTargetIndex;
  for (let index = start; index < chars.length; index += 1) {
    const char = chars[index]!;
    const expected = target[targetIndex]!;
    if (char === expected) {
      targetIndex += 1;
      if (targetIndex === target.length) return targetIndex;
      continue;
    }
    if (targetIndex > 0 && isInsertedSeparator(char)) continue;
    return undefined;
  }
  return targetIndex;
}

function normalizeCodePoint(raw: string): string {
  const codePoint = raw.codePointAt(0);
  if (codePoint === undefined) return "";
  if (codePoint <= 0x7f) {
    if (codePoint >= 0x41 && codePoint <= 0x5a) {
      return String.fromCharCode(codePoint + 0x20);
    }
    return raw;
  }

  let output = "";
  for (const normalized of raw.normalize("NFKC")) {
    for (const lowered of normalized.toLowerCase()) {
      const mapped = mapConfusable(lowered);
      if (!isRemovedForReservedPrefixMatch(mapped)) output += mapped;
    }
  }
  return output;
}

function nextCodePointIndex(text: string, index: number): number {
  const code = text.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff && index + 1 < text.length
    ? index + 2
    : index + 1;
}

function mapConfusable(char: string): string {
  switch (char) {
    case "\u0430":
      return "a";
    case "\u0435":
      return "e";
    case "\u043e":
      return "o";
    case "\u0440":
      return "p";
    case "\u0441":
      return "c";
    case "\u0443":
      return "y";
    case "\u0445":
      return "x";
    case "\u0455":
      return "s";
    case "\u0456":
      return "i";
    case "\u04bb":
      return "h";
    case "\u03bf":
      return "o";
    case "\u03ba":
      return "k";
    case "\u03c1":
      return "p";
    case "\u03c5":
      return "u";
    case "\u03bd":
      return "v";
    case "\u057d":
      return "u";
    case "\u0586":
      return "f";
    case "\u0261":
      return "g";
    case "\u026a":
      return "i";
    default:
      return char;
  }
}

function isRemovedForReservedPrefixMatch(char: string): boolean {
  const codePoint = char.codePointAt(0);
  return (
    codePoint !== undefined &&
    (isZeroWidth(codePoint) ||
      isBidiControl(codePoint) ||
      COMBINING_MARK_PATTERN.test(char))
  );
}

function isZeroWidth(codePoint: number): boolean {
  return (
    codePoint === 0x180e ||
    codePoint === 0x200b ||
    codePoint === 0x200c ||
    codePoint === 0x200d ||
    codePoint === 0x2060 ||
    codePoint === 0xfeff
  );
}

function isBidiControl(codePoint: number): boolean {
  return (
    codePoint === 0x061c ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

function isInsertedSeparator(char: string): boolean {
  return INSERTED_SEPARATOR_PATTERN.test(char);
}

function normalizeReplacement(value: string | undefined): string {
  if (value === undefined) return BLOCKED_INJECTION_MARKER;
  if (typeof value !== "string" || value.length === 0) {
    throw reservedTagPrefixError(
      "Reserved tag prefix replacement must be a non-empty string.",
    );
  }
  return value;
}

function assertRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw reservedTagPrefixError(`${label} must be a plain object.`);
  }
}

function reservedTagPrefixError(message: string): TagfenceError {
  return new TagfenceError(message);
}
