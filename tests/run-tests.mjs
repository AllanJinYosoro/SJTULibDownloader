import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../src/core.js");

function testStripScholarPrefix() {
  const input = "[PDF] Are we there yet?";
  const actual = core.stripScholarPrefix(input);
  assert.equal(actual, "Are we there yet?");
}

function testTitleSimilarityRanking() {
  const source = "Are we there yet? analyzing progress in the conversion funnel";
  const close = "Are We There Yet: Analyzing Progress in the Conversion Funnel";
  const far = "A survey of marine biology methods";

  const closeScore = core.titleSimilarity(source, close);
  const farScore = core.titleSimilarity(source, far);

  assert.ok(closeScore > 0.75, `closeScore too low: ${closeScore}`);
  assert.ok(farScore < 0.3, `farScore too high: ${farScore}`);
}

function testFilenameSanitization() {
  const input = "Are/we:there*yet?<> \"bad\" | name";
  const filename = core.buildFilenameFromTitle(input, 20);

  assert.equal(filename.endsWith(".pdf"), true);
  assert.equal(filename.includes("/"), false);
  assert.equal(filename.includes("?"), false);
  assert.ok(filename.length <= 24, `filename too long: ${filename.length}`);
}

function testPrimoUrlEncoding() {
  const title = "A study on A/B test & growth";
  const url = core.toPrimoSearchUrl(title);
  assert.ok(url.includes("query=any,contains,"));
  assert.ok(url.includes("A%2FB%20test%20%26%20growth"));
}

function testManifestJsonValid() {
  const raw = readFileSync(new URL("../manifest.json", import.meta.url), "utf-8");
  const manifest = JSON.parse(raw);
  assert.equal(manifest.manifest_version, 3);
  assert.ok(Array.isArray(manifest.content_scripts));
}

function testDownloadPathResolution() {
  const absPath = "C:\\Users\\Allan\\Downloads\\";
  const relPath = "papers/sjtu";
  const title = "Are we there yet? test";

  const fallbackName = core.buildDownloadFilename(title, absPath, 80);
  const relName = core.buildDownloadFilename(title, relPath, 80);

  assert.equal(fallbackName.startsWith("papers/"), false);
  assert.ok(fallbackName.endsWith(".pdf"));
  assert.ok(relName.startsWith("papers/sjtu/"));
}

function run() {
  const tests = [
    testStripScholarPrefix,
    testTitleSimilarityRanking,
    testFilenameSanitization,
    testPrimoUrlEncoding,
    testManifestJsonValid,
    testDownloadPathResolution,
  ];

  tests.forEach((t) => t());
  console.log(`All tests passed (${tests.length})`);
}

run();
