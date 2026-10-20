#!/usr/bin/env node
// Bundles the walkthrough page runtime (pi-durable, pi-ai, the renderer, the tutor) into dist/runtime.js.
// Run after changing src/ or updating dependencies: npm install --ignore-scripts && npm run build
import { build } from "esbuild";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(HERE, "dist/runtime.js");
await build({
	entryPoints: [path.join(HERE, "src/main.ts")],
	outfile,
	bundle: true,
	format: "esm",
	platform: "browser",
	target: "es2022",
	minify: true,
	legalComments: "none",
	// pi-ai's OAuth flows import node:http (loopback callback server) and node:crypto; see src/stubs.
	alias: { "node:http": path.join(HERE, "src/stubs/http.ts"), "node:crypto": path.join(HERE, "src/stubs/crypto.ts") },
	nodePaths: [path.join(HERE, "node_modules")],
	logLevel: "warning",
});
console.log(`wrote ${path.relative(process.cwd(), outfile)} (${(statSync(outfile).size / 1024).toFixed(0)} KB)`);
