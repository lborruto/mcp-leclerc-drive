#!/usr/bin/env node
// Network allowlist check on the code itself: every URL literal (http, https, ws, wss) and every
// bare *.leclercdrive.fr host name found in src/ and dist/ must be one the server is allowed to
// talk to. The runtime check in the code is the one that counts; this one keeps a stray host from
// ever reaching it. Comments are scanned too: a host mentioned in a doc comment must be allowed
// as well, so nothing slips in as "just an example".
//
//   node scripts/check-hosts.mjs            scans src/ and, if present, dist/
//   node scripts/check-hosts.mjs DIR...     scans the given directories (used by the tests)
//
// Exits 1 with one `file:line: host` line per finding, 0 with a one-line summary otherwise.
// Source maps (*.map) are skipped: they hold copies of the sources already scanned.
// A URL whose host is not a literal (`https://${host}/…`, "https://" + host) cannot be checked
// here; it is counted as dynamic and left to the runtime check. No dependency: Node's standard library only.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, extname, resolve, isAbsolute } from "node:path";

const ALLOWED_HOST_PATTERNS = [
  /^fd\d+-(courses|secure)\.leclercdrive\.fr$/,
  /^www\.leclercdrive\.fr$/,
  /^api-recherchemagasins\.leclercdrive\.fr$/,
  /^127\.0\.0\.1$/,
  /^localhost$/,
  // The documentation placeholder for a store shard, in messages and comments. Not a host anyone
  // can reach through the server: the runtime allowlist requires digits.
  /^fdN-(courses|secure)\.leclercdrive\.fr$/,
];

// A URL literal: scheme, optional user info, then the host (a name or an IPv4 address). An IPv6
// literal in brackets is caught as "[" so it is reported rather than ignored.
const URL_RE = /\b(?:https?|wss?):\/\/(?:[^\s/@"'`]+@)?(\[[^\]\s]*\]|[A-Za-z0-9.-]+)/g;
// A URL whose host is not a literal (a template expression, or a string concatenation such as
// "https://" + host): decided at runtime.
const DYNAMIC_URL_RE = /\b(?:https?|wss?):\/\/(?=\$\{|["'`])/g;
// A bare host name under leclercdrive.fr, with at least one label (so `.leclercdrive.fr` in a
// suffix check is not a host). `leclercdrive\.fr` with the escaped dot of a regular expression
// does not match: the allowlist regex in the code is not reported as a host.
const BARE_HOST_RE = /\b(?:[A-Za-z0-9-]+\.)+leclercdrive\.fr\b/g;

const SKIPPED_EXTENSIONS = new Set([".map"]);

function isAllowed(host) {
  return ALLOWED_HOST_PATTERNS.some((re) => re.test(host) || re.test(host.toLowerCase()));
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.isFile() && !SKIPPED_EXTENSIONS.has(extname(entry.name))) {
      yield path;
    }
  }
}

// Paths under the current directory are shown relative to it, others in full.
function display(path) {
  const rel = relative(process.cwd(), path);
  return rel.startsWith("..") || isAbsolute(rel) ? resolve(path) : rel;
}

function scanFile(path, state) {
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  state.files += 1;
  lines.forEach((line, i) => {
    const seenOnLine = new Set();
    const record = (host) => {
      if (seenOnLine.has(host)) return;
      seenOnLine.add(host);
      state.references += 1;
      state.hosts.add(host);
      if (!isAllowed(host)) {
        state.findings.push(`${display(path)}:${i + 1}: ${host}`);
      }
    };
    for (const m of line.matchAll(URL_RE)) record(m[1]);
    for (const m of line.matchAll(BARE_HOST_RE)) record(m[0]);
    for (const _ of line.matchAll(DYNAMIC_URL_RE)) state.dynamic += 1;
  });
}

function main(argv) {
  const dirs = argv.length > 0 ? argv : ["src", "dist"].filter((d) => existsSync(d));
  const missing = dirs.filter((d) => !existsSync(d) || !statSync(d).isDirectory());
  if (missing.length > 0) {
    console.error(`check-hosts: not a directory: ${missing.join(", ")}`);
    return 2;
  }
  if (dirs.length === 0) {
    console.error("check-hosts: nothing to scan (no src/ or dist/ here)");
    return 2;
  }

  const state = { files: 0, references: 0, dynamic: 0, hosts: new Set(), findings: [] };
  for (const dir of dirs) {
    for (const file of walk(dir)) scanFile(file, state);
  }

  if (state.findings.length > 0) {
    console.error(`check-hosts: ${state.findings.length} host(s) outside the allowlist:`);
    for (const f of state.findings) console.error(`  ${f}`);
    console.error(
      "Allowed: fd<N>-courses|secure.leclercdrive.fr, www.leclercdrive.fr, " +
        "api-recherchemagasins.leclercdrive.fr, 127.0.0.1, localhost.",
    );
    return 1;
  }

  const hosts = [...state.hosts].sort().join(", ") || "none";
  console.log(
    `check-hosts: OK. ${state.files} file(s) in ${dirs.join(", ")}; ` +
      `${state.references} host reference(s), all allow-listed (${hosts}); ` +
      `${state.dynamic} dynamic URL(s) left to the runtime check.`,
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
