// Gera cloud.js (raiz do site) a partir de src/cloud/index.js, com o Firebase embutido — sem CDN, funciona offline.
// Uso: npm run build
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
await build({
  entryPoints: [here("../src/cloud/index.js")],
  outfile: here("../cloud.js"),
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2020"],
  legalComments: "none",
  banner: { js: "/* Cadência — nuvem (Firebase Auth + Firestore). Fonte: src/cloud/ — gerado por `npm run build`. */" },
});
console.log("cloud.js gerado.");
