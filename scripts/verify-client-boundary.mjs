#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
// Verify the built public output, not merely TypeScript import declarations.
const forbidden = ["4od3UYcN8U4h1p2zJ", "qgKOSP6VWW4rkQTFq", "PPHTJU9PUqwVRjuHX", "stacksignal_import$"];
async function check(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = join(path, entry.name);
    if (entry.isDirectory()) await check(name);
    else if (/\.(js|map|html|json|txt)$/.test(name)) {
      const text = await readFile(name, "utf8");
      if (forbidden.some((fragment) => text.includes(fragment))) throw new Error("Imported private reference data appeared in a public asset: " + name);
    }
  }
}
await check("dist/client");
console.log("Client asset boundary verified: imported catalog remains server-side.");
