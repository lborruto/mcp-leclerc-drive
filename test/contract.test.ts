import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
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
