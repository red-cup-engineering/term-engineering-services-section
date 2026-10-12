#!/usr/bin/env node
import { indexGlossaryKeywordWebFrom } from "../src/glossary-keyword-web.mjs";
export { indexGlossaryKeywordWeb, indexGlossaryKeywordWebFrom } from "../src/glossary-keyword-web.mjs";
if (import.meta.url === `file://${process.argv[1]}`) {
  const index = indexGlossaryKeywordWebFrom(process.argv[2] ?? process.cwd());
  process.stdout.write(`${JSON.stringify({ scopes: index.scopes, edges: index.edges, unresolved: index.unresolved, refused: index.refused }, null, 2)}\n`);
}
