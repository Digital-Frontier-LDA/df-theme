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

/* ── Status aliases ──────────────────────────────────────────────────────────
   good/bad/warn existed as PRIMITIVES (`--df-*`) but under no name an app would
   reach for, so apps declared their own `--success` and shipped a raw hex. The
   README says these were standardised "so the next app doesn't invent a third
   set"; the primitives were right and the alias names were missing. These tests
   pin the names, not the values. */

test("the semantic status aliases exist", () => {
  const css = readFileSync(THEME, "utf8");
  for (const name of ["--success", "--warning", "--info"]) {
    assert.match(
      css,
      new RegExp(`^\\s*${name}\\s*:`, "m"),
      `${name} is missing — an app that wants a status colour will declare its own`,
    );
  }
});

test("status aliases resolve to primitives, never to literal colours", () => {
  // Same invariant as every other alias: an app reskinning by overriding a
  // primitive must see the status colours follow. A literal here silently opts
  // status out of the theme.
  const css = readFileSync(THEME, "utf8");
  for (const name of ["--success", "--warning", "--info"]) {
    const m = css.match(new RegExp(`^\\s*${name}\\s*:\\s*([^;]+);`, "m"));
    assert.ok(m, `${name} not found`);
    assert.match(
      m[1].trim(),
      /^var\(--df-[a-z0-9-]+\)$/,
      `${name} must be var() onto a primitive, got: ${m[1].trim()}`,
    );
  }
});

test("a status alias is refused when an app redeclares it", () => {
  // The whole point: once the package owns --success, an app declaring its own
  // is drift and the checker must say so.
  fails(`${IMPORT}\n:root { --success: #22c55e; }`);
});

test("--df-info exists, because --info cannot alias a primitive that is absent", () => {
  const css = readFileSync(THEME, "utf8");
  assert.match(css, /^\s*--df-info\s*:/m, "--df-info primitive is missing");
});

/* ── The documented reskin path must actually pass ───────────────────────────
   `ownedTokens()` parsed every `--x:` in `:root`, primitives included — so an
   app overriding a `--df-*` primitive was flagged as drift. Both the README
   ("Override a primitive, never an alias") and this checker's own failure
   message ("To intentionally reskin, override a --df-* PRIMITIVE instead so the
   aliases follow") recommend exactly that. The tool rejected its own remedy: an
   app that followed the documentation could not pass its own CI. */

test("overriding a --df-* PRIMITIVE is allowed — it is the documented reskin", () => {
  passes(`${IMPORT}\n:root { --df-rail: var(--df-bg); }`);
});

test("overriding an ALIAS is still refused — that is the real drift", () => {
  // The distinction the fix rests on: a primitive override reskins and the
  // aliases follow; an alias override DETACHES from the primitive and starts a
  // new palette. If this ever passes, the checker has stopped doing its job.
  fails(`${IMPORT}\n:root { --sidebar: oklch(0.13 0 0); }`);
});

test("a primitive reskin alongside an app-only token is clean", () => {
  // The shape a real adopting app has: keep one design-justified primitive
  // override, add tokens the package does not own, change no alias.
  passes(`${IMPORT}\n:root {\n  --df-rail: var(--df-bg);\n  --sidebar-muted: var(--df-muted);\n}`);
});

/* ── Destructive foreground contrast ─────────────────────────────────────────
   `--destructive-foreground` aliased `--df-text`, which measures 4.29:1 on
   `--df-bad` — AA-large, not AA. Apps hit this and hardcoded `text-white`,
   which passes but leaves the monochrome palette and decouples foreground from
   background, so a reskin moves one and not the other. `--df-on-bad` exists so
   the SEMANTIC token is also the accessible one. */

test("--destructive-foreground aliases --df-on-bad, not --df-text", () => {
  const css = readFileSync(THEME, "utf8");
  const m = css.match(/^\s*--destructive-foreground\s*:\s*([^;]+);/m);
  assert.ok(m, "--destructive-foreground not found");
  assert.equal(
    m[1].trim(),
    "var(--df-on-bad)",
    "destructive-foreground must use the on-bad primitive; --df-text is only 4.29:1 on --df-bad",
  );
});

test("--df-on-bad exists as a primitive", () => {
  assert.match(readFileSync(THEME, "utf8"), /^\s*--df-on-bad\s*:/m);
});

/* ── `.dark` overrides ───────────────────────────────────────────────────────
   The check only looked at `:root`, so a `.dark` block redefining a
   package-owned token passed clean while WINNING at runtime. In a dark-only
   theme `.dark` is not a scope, it is the theme — an app rendering
   `<html class="dark">` (the shape this package targets, and what its own
   `.dark { color-scheme: dark }` block serves) has that block beat `:root`.
   Found in a real adopting app that carried a full `.dark` palette alongside
   the import and reported clean. */

test("a .dark block redefining an owned token FAILS", () => {
  fails(`${IMPORT}\n.dark { --primary: oklch(0.5 0.2 250); }`);
});

test("html.dark is caught the same way", () => {
  fails(`${IMPORT}\nhtml.dark { --background: #000; }`);
});

test("a selector list containing .dark is caught", () => {
  // Deliberately NOT `:root, .dark` — that form passes under the old
  // `:root`-only check too, so it would prove nothing about comma handling.
  // `.app` is non-global, so `.dark` is the only thing that can trip this.
  fails(`${IMPORT}\n.app, .dark { --card: #111; }`);
});

test("HTML.dark is caught — type selectors are case-insensitive in HTML", () => {
  fails(`${IMPORT}\nHTML.dark { --primary: oklch(0.5 0.2 250); }`);
});

test(":ROOT is caught for the same reason", () => {
  fails(`${IMPORT}\n:ROOT { --primary: oklch(0.5 0.2 250); }`);
});

test(".Dark is NOT caught — class selectors ARE case-sensitive", () => {
  // A different class entirely. Flagging it would be a false positive, and the
  // reason a blanket /i on the whole selector would be wrong.
  passes(`${IMPORT}\n.Dark { --primary: oklch(0.5 0.2 250); }`);
});

test("a SCOPED .dark descendant override stays legal", () => {
  // Same category as tron's `.report-page`: varying a token inside a subtree is
  // a different surface, not a palette override. Flagging it would make the
  // check unusable for any app with a themed subtree.
  passes(`${IMPORT}\n.dark .badge { --primary: oklch(0.5 0.2 250); }`);
});

test("the package's own .dark block does not trip the check", () => {
  // theme.css declares `.dark { color-scheme: dark }` — no custom properties,
  // so it must stay clean under the widened rule.
  assert.match(readFileSync(THEME, "utf8"), /\.dark\s*\{\s*color-scheme:\s*dark;\s*\}/);
});
