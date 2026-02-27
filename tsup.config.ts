import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  dts: false,
  splitting: false,
  sourcemap: false,
  minify: true,
  shims: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  treeshake: true,
});
