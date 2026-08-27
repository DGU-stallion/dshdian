import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

import { resolve } from "path";
import { builtinModules } from "module";

// Node.js builtins are available in Obsidian's Electron environment
const nodeBuiltins = builtinModules.flatMap(m => [m, `node:${m}`]);

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian", "electron", "@codemirror/*", "@lezer/*", "esbuild",
    ...nodeBuiltins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  // Force `ws` to resolve to its Node.js entry, not the browser stub.
  // Obsidian runs in Electron with full Node.js access.
  alias: {
    "ws": resolve("node_modules/ws/index.js"),
  },
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
