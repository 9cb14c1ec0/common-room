import assert from "node:assert/strict";
import test from "node:test";
import { KEY_TERM_MAX_COUNT, normalizeKeyTerms } from "./keyTerms.js";

test("terms are trimmed and blank lines dropped", () => {
  const { terms, rejected, overflow } = normalizeKeyTerms(["  Kestrel  ", "", "   ", "Acme Onboarding"]);
  assert.deepEqual(terms, ["Kestrel", "Acme Onboarding"]);
  assert.deepEqual(rejected, []);
  assert.equal(overflow, 0);
});

test("duplicates are removed case-insensitively, keeping the first spelling", () => {
  const { terms } = normalizeKeyTerms(["Kestrel", "kestrel", "KESTREL"]);
  assert.deepEqual(terms, ["Kestrel"]);
});

test("terms longer than the ElevenLabs character limit are rejected", () => {
  const long = "a".repeat(51);
  const { terms, rejected } = normalizeKeyTerms(["Kestrel", long]);
  assert.deepEqual(terms, ["Kestrel"]);
  assert.deepEqual(rejected, [long]);
});

test("terms with more than five words are rejected", () => {
  const { terms, rejected } = normalizeKeyTerms(["one two three four five", "one two three four five six"]);
  assert.deepEqual(terms, ["one two three four five"]);
  assert.deepEqual(rejected, ["one two three four five six"]);
});

test("characters the ElevenLabs API refuses are rejected", () => {
  const { terms, rejected } = normalizeKeyTerms(["Kestrel", "a<b", "c{d", "e[f", "g\\h"]);
  assert.deepEqual(terms, ["Kestrel"]);
  assert.deepEqual(rejected, ["a<b", "c{d", "e[f", "g\\h"]);
});

test("unique terms beyond the cap are reported as overflow", () => {
  const input = Array.from({ length: KEY_TERM_MAX_COUNT + 3 }, (_, index) => `term${index}`);
  const { terms, overflow } = normalizeKeyTerms(input);
  assert.equal(terms.length, KEY_TERM_MAX_COUNT);
  assert.equal(overflow, 3);
});

test("duplicates do not count toward the cap", () => {
  const { terms, overflow } = normalizeKeyTerms(Array.from({ length: KEY_TERM_MAX_COUNT + 50 }, (_, index) => `term${index % KEY_TERM_MAX_COUNT}`));
  assert.equal(terms.length, KEY_TERM_MAX_COUNT);
  assert.equal(overflow, 0);
});
