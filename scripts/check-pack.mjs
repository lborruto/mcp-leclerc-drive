#!/usr/bin/env node
// What the release tarball holds: `npm pack --dry-run --json` is asked for the file list, which
// must be dist/ (every file matching a source file in src/), package.json, README.md, LICENSE
// and, if npm includes them, CHANGELOG.md and SECURITY.md. Nothing else: no stale build output
// (a dist/auth/ left over from an older version), no source map of a file that no longer exists,
// no compiled test, no capture or env file. Run after `npm run build`.
//
//   node scripts/check-pack.mjs
//
// Exits 1 listing each unexpected file, 0 with a one-line summary otherwise. No dependency.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT_FILES = new Set(["package.json", "README.md", "LICENSE", "CHANGELOG.md", "SECURITY.md"]);
const REQUIRED = ["package.json", "README.md", "LICENSE", "dist/index.js"];
// A dist file is dist/<path>.<ext> for a src/<path>.ts; these are the extensions tsc writes
// (tsconfig: declaration and sourceMap on).
const DIST_RE = /^dist\/(.+?)\.(js|d\.ts|js\.map|d\.ts\.map)$/;
// Unit tests are not shipped, wherever they are compiled from.
const TEST_RE = /(^|\/)(__tests__|tests?)\/|\.test\.|\.spec\./;

function packedFiles() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const out = execFileSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "inherit"],
  });
  // npm prints one array with one entry per packed package.
  const json = JSON.parse(out.slice(out.indexOf("[")));
  const pkg = json[0];
  return { name: pkg.filename, size: pkg.unpackedSize, files: pkg.files.map((f) => f.path) };
}

function main() {
  const { name, size, files } = packedFiles();
  const problems = [];

  for (const file of files) {
    if (ROOT_FILES.has(file)) continue;
    const m = DIST_RE.exec(file);
    if (!m) {
      problems.push(`${file}: not dist/, package.json, README.md, LICENSE, CHANGELOG.md or SECURITY.md`);
      continue;
    }
    if (TEST_RE.test(file)) {
      problems.push(`${file}: a test file; tests do not go in the tarball`);
      continue;
    }
    const source = join("src", `${m[1]}.ts`);
    if (!existsSync(source)) {
      problems.push(`${file}: no ${source} (stale build output; run \`npm run build\` from a clean dist/)`);
    }
  }
  for (const file of REQUIRED) {
    if (!files.includes(file)) problems.push(`${file}: missing from the tarball`);
  }

  if (problems.length > 0) {
    console.error(`check-pack: ${problems.length} problem(s) in ${name}:`);
    for (const p of problems) console.error(`  ${p}`);
    return 1;
  }
  const dist = files.filter((f) => f.startsWith("dist/")).length;
  console.log(
    `check-pack: OK. ${name}: ${files.length} file(s), ${dist} under dist/ (each with its src/ file), ` +
      `${files.length - dist} at the root; ${size} bytes unpacked.`,
  );
  return 0;
}

process.exitCode = main();
