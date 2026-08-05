#!/usr/bin/env node
/**
 * Fail if an app redefines a canonical theme token locally.
 *
 * WHY. Importing the theme is not enough. CSS custom properties are
 * last-declaration-wins, so an app that keeps its own `--primary: ...` silently
 * overrides the package and looks correct to whoever wrote it. That is exactly
 * how four apps ended up with two palettes: everyone believed they had applied
 * "the theme".
 *
 * This checks the property that matters — the app does not declare tokens the
 * package owns — rather than the presence of an @import, which proves nothing.
 *
 *   npx df-theme-check                 # scans ./src ./app ./styles
 *   npx df-theme-check path/to.css …   # or explicit files
 *
 * Exit 0 clean, 1 on any local redefinition, 2 on bad usage.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = resolve(HERE, "..", "theme.css");

/** Tokens the package owns. Parsed from theme.css so the two can never drift. */
function ownedTokens() {
  const css = readFileSync(THEME, "utf8");
  const owned = new Set();
  // Only :root declarations — @theme entries are Tailwind plumbing, and an app
  // legitimately adding its own --color-* utility is not a palette override.
  const root = css.slice(css.indexOf(":root {"), css.indexOf("\n}"));
  for (const m of root.matchAll(/^\s*--([a-z0-9-]+)\s*:/gim)) owned.add(m[1]);
  return owned;
}

/** Strip comments so a documented example or an explanation cannot trip this. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function cssFilesUnder(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e.startsWith(".")) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) cssFilesUnder(p, acc);
    else if (e.endsWith(".css")) acc.push(p);
  }
  return acc;
}

function main(argv) {
  const owned = ownedTokens();
  if (owned.size === 0) {
    console.error("df-theme-check: could not parse any tokens from theme.css");
    return 2;
  }

  const files = argv.length
    ? argv
    : ["src", "app", "styles", "web/src", "frontend/app", "dashboard/src"]
        .flatMap((d) => cssFilesUnder(d));

  if (files.length === 0) {
    // Fail closed: scanning nothing and reporting success is indistinguishable
    // from scanning a compliant app.
    console.error("df-theme-check: no CSS files found — nothing was checked.");
    console.error("Pass paths explicitly if your CSS lives elsewhere.");
    return 1;
  }

  const problems = [];
  let importing = 0;

  for (const f of files) {
    let css;
    try {
      css = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const body = stripComments(css);
    // Check the import on the STRIPPED body: a commented-out example (this
    // package's own header contains one) must not count as importing.
    if (/@import\s+["'][^"']*@digitalfrontier\/theme/.test(body)) importing++;
    // Character scanner rather than a per-line pass. A line-based check has to
    // decide the enclosing selector BEFORE it has seen the `{` on that same
    // line, so `:root { --primary: red; }` written on one line slips through —
    // which is exactly the shape someone adds when re-introducing an override.
    //
    // Only a :root declaration overrides the package globally. A SCOPED
    // re-definition is a different surface, not a palette override: tron
    // legitimately does `.report-page { --background: #ffffff; }` for print,
    // and flagging that would make the check unusable for any app with a light
    // print or embed surface.
    const stack = [];
    let buf = "";
    let line = 1;
    const isRootSel = (sel) =>
      /(^|,)\s*:root\b/.test(sel || "") &&
      !stack.slice(0, -1).some((s) => s.trim().startsWith("@media"));

    for (const ch of body) {
      if (ch === "\n") {
        line++;
        buf += " ";
        continue;
      }
      if (ch === "{") {
        stack.push(buf.trim());
        buf = "";
      } else if (ch === "}") {
        stack.pop();
        buf = "";
      } else if (ch === ";") {
        const decl = buf.match(/(?:^|\s)--([a-z0-9-]+)\s*:/i);
        if (decl) {
          const name = decl[1].toLowerCase();
          if (owned.has(name) && isRootSel(stack[stack.length - 1])) {
            problems.push({
              file: f,
              line,
              token: name,
              text: buf.trim().slice(0, 100),
              sel: stack[stack.length - 1],
            });
          }
        }
        buf = "";
      } else {
        buf += ch;
      }
    }
  }

  console.log(
    `df-theme-check: ${files.length} file(s), ${owned.size} owned token(s), ${importing} importing the package`
  );

  if (problems.length) {
    console.error("\nLocal redefinitions of package-owned tokens:");
    for (const p of problems.slice(0, 40)) {
      console.error(`  x ${p.file}:${p.line}  --${p.token}`);
      console.error(`      ${p.text}`);
    }
    if (problems.length > 40) {
      console.error(`  … and ${problems.length - 40} more`);
    }
    console.error(
      "\nCSS custom properties are last-declaration-wins, so these OVERRIDE the"
    );
    console.error(
      "package and the app will look 'themed' while being off-palette. Delete"
    );
    console.error(
      "them. To intentionally reskin, override a --df-* PRIMITIVE instead so the"
    );
    console.error("aliases follow.");
    return 1;
  }

  if (importing === 0) {
    console.error(
      "\nNo file imports @digitalfrontier/theme — the app has no palette at all."
    );
    return 1;
  }

  console.log("clean — no app-local overrides of canonical tokens.");
  return 0;
}

process.exit(main(process.argv.slice(2)));
