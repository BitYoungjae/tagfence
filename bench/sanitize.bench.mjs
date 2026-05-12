import { performance } from "node:perf_hooks";

import { sanitize } from "../dist/index.js";

const WARMUP_MS = 200;
const SAMPLE_MS = 400;
const RUNS = 7;

// Global sink prevents V8 from eliminating calls whose result is unused.
let sink = "";

function measure(fn) {
  const warmupStart = performance.now();
  while (performance.now() - warmupStart < WARMUP_MS) sink = fn();

  const samples = [];
  for (let run = 0; run < RUNS; run += 1) {
    let ops = 0;
    const start = performance.now();
    let elapsed = 0;
    while (elapsed < SAMPLE_MS) {
      sink = fn();
      ops += 1;
      elapsed = performance.now() - start;
    }
    samples.push(elapsed / ops);
  }
  samples.sort((a, b) => a - b);
  return {
    median: samples[Math.floor(samples.length / 2)],
    min: samples[0],
    max: samples[samples.length - 1],
  };
}

function formatTime(ms) {
  if (ms < 0.001) return `${(ms * 1_000_000).toFixed(1)} ns`;
  if (ms < 1) return `${(ms * 1000).toFixed(2)} µs`;
  return `${ms.toFixed(3)} ms`;
}

function formatThroughput(bytesPerCall, ms) {
  const mbPerSec = bytesPerCall / (ms / 1000) / (1024 * 1024);
  return `${mbPerSec.toFixed(1)} MB/s`;
}

function bench(label, input, fn) {
  const bytes = Buffer.byteLength(input, "utf8");
  const result = measure(() => fn(input));
  const median = result.median;
  const spread = ((result.max - result.min) / median) * 100;
  console.log(
    `  ${label.padEnd(46)} ${formatTime(median).padStart(10)}   ` +
      `${formatThroughput(bytes, median).padStart(10)}   ±${spread.toFixed(1)}%`,
  );
}

function section(title) {
  console.log(`\n${title}`);
  console.log("-".repeat(86));
  console.log(
    `  ${"scenario".padEnd(46)} ${"per call".padStart(10)}   ` +
      `${"throughput".padStart(10)}   variance`,
  );
}

const PREFIX = "engine:";
const call = (text) => sanitize(text, { prefix: PREFIX });

const asciiLine = "lorem ipsum dolor sit amet consectetur adipiscing elit. ";
const unicodeLine = "안녕하세요 lorem ipsum 中文文本 русский текст ";

const repeat = (s, target) => {
  const out = [];
  let total = 0;
  while (total < target) {
    out.push(s);
    total += s.length;
  }
  return out.join("");
};

const inputs = {
  asciiSmall: repeat(asciiLine, 1_000),
  asciiMedium: repeat(asciiLine, 10_000),
  asciiLarge: repeat(asciiLine, 100_000),
  unicodeSmall: repeat(unicodeLine, 1_000),
  unicodeMedium: repeat(unicodeLine, 10_000),
};

const matchBlockAscii =
  "lorem ipsum <engine:inbox>payload</engine:inbox> dolor ";
const matchBlockFullwidth =
  "lorem ipsum <ｅｎｇｉｎｅ：inbox>payload</ｅｎｇｉｎｅ：inbox> dolor ";
const matchBlockHomoglyph =
  "lorem ipsum <еngіnе:inbox>payload</еngіnе:inbox> dolor ";
const matchBlockZeroWidth =
  "lorem ipsum <e‌n‌g‌i‌n‌e:inbox>p</e‌n‌g‌i‌n‌e:inbox> dolor ";
const matchBlockCombining = "lorem ipsum <éńǵíńé:inbox>p</éńǵíńé:inbox> dolor ";

const matchInputs = {
  ascii: repeat(matchBlockAscii, 10_000),
  fullwidth: repeat(matchBlockFullwidth, 10_000),
  homoglyph: repeat(matchBlockHomoglyph, 10_000),
  zeroWidth: repeat(matchBlockZeroWidth, 10_000),
  combining: repeat(matchBlockCombining, 10_000),
};

function bytes(s) {
  return Buffer.byteLength(s, "utf8");
}

console.log(
  `Node ${process.versions.node} on ${process.platform}/${process.arch}`,
);
console.log(
  `Sampling: ${RUNS} runs × ${SAMPLE_MS}ms after ${WARMUP_MS}ms warmup`,
);

section("No-match throughput (ASCII text)");
bench(
  `ASCII ${bytes(inputs.asciiSmall).toLocaleString()} bytes`,
  inputs.asciiSmall,
  call,
);
bench(
  `ASCII ${bytes(inputs.asciiMedium).toLocaleString()} bytes`,
  inputs.asciiMedium,
  call,
);
bench(
  `ASCII ${bytes(inputs.asciiLarge).toLocaleString()} bytes`,
  inputs.asciiLarge,
  call,
);

section("No-match throughput (mixed-script text)");
bench(
  `Unicode ${bytes(inputs.unicodeSmall).toLocaleString()} bytes`,
  inputs.unicodeSmall,
  call,
);
bench(
  `Unicode ${bytes(inputs.unicodeMedium).toLocaleString()} bytes`,
  inputs.unicodeMedium,
  call,
);

section("Match-heavy throughput (per bypass form)");
bench(
  `plain ASCII matches (${bytes(matchInputs.ascii).toLocaleString()} bytes)`,
  matchInputs.ascii,
  call,
);
bench(
  `fullwidth matches (${bytes(matchInputs.fullwidth).toLocaleString()} bytes)`,
  matchInputs.fullwidth,
  call,
);
bench(
  `homoglyph matches (${bytes(matchInputs.homoglyph).toLocaleString()} bytes)`,
  matchInputs.homoglyph,
  call,
);
bench(
  `zero-width matches (${bytes(matchInputs.zeroWidth).toLocaleString()} bytes)`,
  matchInputs.zeroWidth,
  call,
);
bench(
  `combining-mark matches (${bytes(matchInputs.combining).toLocaleString()} bytes)`,
  matchInputs.combining,
  call,
);

// Force sink observation so the loops are not eliminated.
if (sink.length < 0) console.log(sink);
