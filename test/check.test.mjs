/**
 * Tests for df-theme-check.
 *
 * Every case below either encodes a bug this checker actually shipped, or an
 * invariant the package documents. They are written as behaviour ("does a file
 * shaped like X pass or fail") rather than by inspecting internals, because all
 * four historical bugs were invisible from reading the code and only appeared
 * when a real file was run through it.
 *
 *   node --test test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = resolve(HERE, "..", "bin", "df-theme-check.mjs");
const THEME = resolve(HERE, "..", "theme.css");
const IMPORT = '@import "@digitalfrontier/theme";';

/** Run the checker over one CSS body; return its exit code. */
function run(css) {
  const dir = mkdtempSync(join(tmpdir(), "df-theme-"));
  const file = join(dir, "globals.css");
  writeFileSync(file, css);
  try {
    execFileSync(process.execPath, [CHECK, file], { stdio: "pipe" });
    return 0;
  } catch (e) {
    return e.status ?? 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const passes = (css) => assert.equal(run(css), 0);
const fails = (css) => assert.equal(run(css), 1);

test("a file that imports the package and declares nothing is clean", () => {
  passes(`${IMPORT}\n.x { color: var(--primary); }\n`);
});

test("a :root override of an owned token fails", () => {
  fails(`${IMPORT}\n:root {\n  --primary: red;\n}\n`);
});

// REGRESSION: the original scanner was line-based, so it had to decide the
// enclosing selector before seeing the `{` on that same line. A single-line
// block slipped straight through — and it is exactly the shape someone uses
// when re-adding an override.
test("a single-line :root override fails", () => {
  fails(`${IMPORT}\n:root { --primary: red; }\n`);
});

// REGRESSION: `:root` nested in @media was exempt, making this a one-line
// bypass of the entire check.
test("a :root override inside @media fails", () => {
  fails(`${IMPORT}\n@media (min-width: 1px) { :root { --background: #fff; } }\n`);
});

test("a light prefers-color-scheme override fails (this theme is dark-only)", () => {
  fails(
    `${IMPORT}\n@media (prefers-color-scheme: light) { :root { --foreground: #000; } }\n`
  );
});

// The print surface is a genuinely different surface, not a palette override.
test("a :root override inside @media print is allowed", () => {
  passes(`${IMPORT}\n@media print { :root { --background: #fff; } }\n`);
});

// REGRESSION: tron's real `.report-page` print scope was flagged as a violation,
// which would have made the checker unusable for any app with a paper surface.
test("a scoped class re-definition is allowed", () => {
  passes(`${IMPORT}\n.report-page { --background: #fff; --foreground: #111; }\n`);
});

test("an app-owned token that the package does not define is allowed", () => {
  passes(`${IMPORT}\n:root { --my-app-gutter: 12px; }\n`);
});

// Fail-closed: reporting success for a file with no palette at all is
// indistinguishable from reporting success for a compliant one.
test("a file that imports nothing fails", () => {
  fails(`.x { color: red; }\n`);
});

// REGRESSION: the header of theme.css contains a commented-out example @import.
// A comment must not satisfy the import requirement.
test("a commented-out import does not count as importing", () => {
  fails(`/* ${IMPORT} */\n.x { color: red; }\n`);
});

test("an override inside a comment is not a violation", () => {
  passes(`${IMPORT}\n/* :root { --primary: red; } */\n.x { color: red; }\n`);
});

test("scanning zero files fails rather than reporting success", () => {
  const dir = mkdtempSync(join(tmpdir(), "df-theme-empty-"));
  let code = 0;
  try {
    execFileSync(process.execPath, [CHECK, join(dir, "nope.css")], { stdio: "pipe" });
  } catch (e) {
    code = e.status ?? 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(code, 1);
});

// ── theme.css invariants ────────────────────────────────────────────────────
// The package documents a three-layer structure. If an alias stops tracking a
// primitive, reskinning silently breaks: overriding --df-beige would no longer
// move --primary, and you would be starting a fifth palette.

test("every alias resolves to a var(), never a literal colour", () => {
  const css = readFileSync(THEME, "utf8");
  const root = css.slice(css.indexOf(":root {"), css.indexOf("\n}"));
  const offenders = [];
  for (const m of root.matchAll(/^\s*--([a-z0-9-]+)\s*:\s*([^;]+);/gim)) {
    const [, name, value] = m;
    if (name.startsWith("df-")) continue; // primitives are where literals live
    if (name.startsWith("radius")) continue; // geometry, calc() not var()
    if (name === "radius") continue;
    if (!value.includes("var(")) offenders.push(`--${name}: ${value.trim()}`);
  }
  assert.deepEqual(offenders, [], `aliases must be var() onto a primitive`);
});

test("color-scheme is declared at :root, not only under .dark", () => {
  const css = readFileSync(THEME, "utf8");
  const root = css.slice(css.indexOf(":root {"), css.indexOf("\n}"));
  assert.match(
    root,
    /color-scheme:\s*dark/,
    "a dark-only theme must set color-scheme at :root, or apps without a .dark class render native controls light"
  );
});

test("every @theme mapping points at a token that exists", () => {
  const css = readFileSync(THEME, "utf8");
  const root = css.slice(css.indexOf(":root {"), css.indexOf("\n}"));
  const defined = new Set([...root.matchAll(/^\s*--([a-z0-9-]+)\s*:/gim)].map((m) => m[1]));
  const themeBlock = css.slice(css.indexOf("@theme inline {"));
  const dangling = [];
  for (const m of themeBlock.matchAll(/^\s*--[a-z0-9-]+\s*:\s*var\(--([a-z0-9-]+)\)/gim)) {
    if (!defined.has(m[1])) dangling.push(m[1]);
  }
  assert.deepEqual(dangling, [], "@theme references an undefined token");
});
