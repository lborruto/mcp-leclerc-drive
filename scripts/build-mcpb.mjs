#!/usr/bin/env node
// Builds the Claude Desktop bundle (an .mcpb file: a zip with a manifest) from the built dist/:
//
//   manifest.json   mcpb/manifest.json with the version of package.json
//   package.json    (dist/index.js reads its version there), LICENSE, README.md
//   dist/**/*.js    the server, without source maps or type declarations
//   node_modules/   the production dependencies, from a clean `npm ci --omit=dev --ignore-scripts`
//                   of package-lock.json in a temporary directory
//
//   node scripts/build-mcpb.mjs [OUT_DIR]     writes OUT_DIR/mcp-leclerc-drive-X.Y.Z.mcpb
//
// Run after `npm run build`. The zip is written here, with Node's zlib: no dependency, and the
// same bytes for the same input (sorted entries, fixed dates). Symbolic links are left out
// (node_modules/.bin is not needed to run the server).

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const ROOT = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/** Every regular file under `dir`, as paths relative to it with forward slashes, sorted. */
function walk(dir, keep = () => true, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), keep, rel));
    else if (entry.isFile() && keep(rel)) out.push(rel);
  }
  return out;
}

/** A zip archive of `entries` ({ name, data }), deflated, dated 1980-01-01 (the format's zero). */
export function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4); // version needed
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt16LE(0, 10); // time
    head.writeUInt16LE(0x21, 12); // date: 1980-01-01
    head.writeUInt32LE(crc32(data), 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix
    head.copy(dir, 6, 4, 30); // version needed … name length
    dir.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
    dir.writeUInt32LE(offset, 42);
    chunks.push(head, nameBuf, packed);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + packed.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

function main() {
  const outDir = resolve(process.argv[2] ?? ROOT);
  if (!existsSync(join(ROOT, "dist", "index.js"))) {
    console.error("build-mcpb: dist/index.js is missing; run `npm run build` first");
    return 1;
  }
  const stage = mkdtempSync(join(tmpdir(), "mcpb-"));
  try {
    for (const f of ["package.json", "package-lock.json", "LICENSE", "README.md"]) cpSync(join(ROOT, f), join(stage, f));
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    execFileSync(npm, ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: stage,
      shell: process.platform === "win32",
      stdio: ["ignore", "ignore", "inherit"],
    });
    const manifest = JSON.parse(readFileSync(join(ROOT, "mcpb", "manifest.json"), "utf8"));
    manifest.version = pkg.version;

    const entries = [
      { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2) + "\n") },
      ...["package.json", "LICENSE", "README.md"].map((f) => ({ name: f, data: readFileSync(join(stage, f)) })),
      ...walk(join(ROOT, "dist"), (f) => f.endsWith(".js")).map((f) => ({
        name: `dist/${f}`,
        data: readFileSync(join(ROOT, "dist", f)),
      })),
      ...walk(join(stage, "node_modules"), (f) => !f.startsWith(".bin/") && f !== ".package-lock.json").map((f) => ({
        name: `node_modules/${f}`,
        data: readFileSync(join(stage, "node_modules", f)),
      })),
    ];
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, `mcp-leclerc-drive-${pkg.version}.mcpb`);
    const archive = zip(entries);
    writeFileSync(file, archive);
    console.log(`build-mcpb: OK. ${file}: ${entries.length} file(s), ${archive.length} bytes.`);
    return 0;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (import.meta.filename === resolve(process.argv[1] ?? "")) process.exitCode = main();
