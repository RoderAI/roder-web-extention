import { build } from "vite";
for (const [entry, file] of [
  ["content-script", "content-script"],
  ["pair", "pair"],
]) {
  await build({
    configFile: false,
    build: {
      emptyOutDir: false,
      sourcemap: true,
      lib: {
        entry: `src/content/${entry}.ts`,
        name: `Roder_${entry.replace("-", "_")}`,
        formats: ["iife"],
        fileName: () => `content/${file}.js`,
      },
    },
  });
}
