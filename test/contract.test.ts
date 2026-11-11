import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Starts the built server (dist/, `npm test` builds it first) over stdio, as an
// MCP client would. Listing tools never starts Chrome or touches the network.
async function listTools() {
  const home = mkdtempSync(join(tmpdir(), "leclerc-contract-"));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("LECLERC_")) env[k] = v;
  const client = new Client({ name: "contract-test", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["dist/index.js"],
      env: { ...env, HOME: home, USERPROFILE: home },
      stderr: "ignore",
    }),
  );
  try {
    return {
      tools: (await client.listTools()).tools,
      prompts: (await client.listPrompts()).prompts,
      instructions: client.getInstructions() ?? "",
    };
  } finally {
    await client.close();
  }
}

/** Call a tool on a fresh server with an empty home (no drive chosen, no Chrome started). */
async function callTool(name: string): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), "leclerc-contract-"));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("LECLERC_")) env[k] = v;
  const client = new Client({ name: "contract-test", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["dist/index.js"],
      // A port nothing listens on: get_store only looks, it starts nothing.
      env: { ...env, HOME: home, USERPROFILE: home, LECLERC_CHROME_PORT: "59333" },
      stderr: "ignore",
    }),
  );
  try {
    const res = await client.callTool({ name, arguments: {} });
    return (res.content as Array<{ text: string }>).map((c) => c.text).join("\n");
  } finally {
    await client.close();
  }
}

test("the server exposes exactly the cart-filling tools", async () => {
  const { tools, prompts, instructions } = await listTools();
  assert.deepEqual(prompts.map((p) => p.name), ["courses"]);
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "add_many",
    "add_to_cart",
    "diagnostic",
    "find_stores",
    "forget_usual",
    "get_cart",
    "get_store",
    "list_usuals",
    "remove_from_cart",
    "save_usual",
    "search_product",
    "set_store",
    "update_quantity",
  ]);
  // The permanent rule: nothing past the cart.
  for (const t of tools) {
    assert.doesNotMatch(`${t.name} ${t.title ?? ""}`, /checkout|order|pay|slot|commander|commande|paie|créneau|valider/i, t.name);
  }
  assert.match(instructions, /aucun outil ne valide/);

  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const items = (byName.add_many.inputSchema.properties as Record<string, { maxItems?: number }>).items;
  assert.equal(items.maxItems, 30);
  assert.equal(byName.get_cart.annotations?.readOnlyHint, true);
  assert.equal(byName.remove_from_cart.annotations?.destructiveHint, true);
});

test("the Claude Desktop manifest names the server's tools and prompts", async () => {
  const { tools, prompts } = await listTools();
  const manifest = JSON.parse(readFileSync("mcpb/manifest.json", "utf8")) as {
    tools: Array<{ name: string }>;
    prompts: Array<{ name: string }>;
    server: { entry_point: string };
  };
  assert.deepEqual(manifest.tools.map((t) => t.name).sort(), tools.map((t) => t.name).sort());
  assert.deepEqual(manifest.prompts.map((p) => p.name), prompts.map((p) => p.name));
  assert.equal(manifest.server.entry_point, "dist/index.js");
});

test("with no drive chosen, the tools ask for one instead of shopping at a default drive", async () => {
  const text = await callTool("get_cart");
  assert.match(text, /Aucun drive choisi.*find_stores/);
  assert.match(await callTool("get_store"), /Aucun drive choisi/);
});
