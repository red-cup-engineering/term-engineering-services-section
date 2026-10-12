import { basename, extname as projectFilepathExtension } from "node:path";
import {
  readMarkdownVaultGlossaryScopeReadings,
  resolveMarkdownVaultKeywordIndexFromReadings,
} from "@red-cup-engineering/markdown-engineering-services-section/resolve-markdown-vault-relation-keys";
import { recognizeTermMarkdown } from "./term-carrier.mjs";

function frozenEdge(from, to, keyword) { return Object.freeze({ from, to, keyword, relation: "declares-keyword" }); }
function finding(rule, message) { return Object.freeze({ rule, message }); }

function syntheticScope(depth, count) {
  const descendantCount = count - depth - 1;
  return ["vault", ...Array.from({ length: descendantCount }, (_, index) => `services/scope-${index}`)].join("/");
}

/**
 * Domain facade over the upstream Markdown-vault keyword resolver. An invalid or duplicate-stem
 * document is accounted in the returned `refused` list rather than aborting the whole index.
 * @param {Array<{directory: string, documents: Array<{filename: string, text: string}>}>} scopes nearest-first
 * @returns {{scopes: string[], edges: object[], unresolved: object[], refused: object[], backlinksFor: (stem: string) => string[]}}
 */
export function indexGlossaryKeywordWeb(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) throw new TypeError("at least one nearest-first glossary scope is required");
  const documentsByPath = new Map();
  const readings = [];
  const refused = [];
  for (const [depth, scope] of scopes.entries()) {
    if (!scope || typeof scope.directory !== "string" || !Array.isArray(scope.documents)) throw new TypeError("each scope requires directory and documents");
    const seen = new Set();
    for (const { filename, text } of scope.documents) {
      const recognized = recognizeTermMarkdown({ text, filename });
      if (!recognized.term) { refused.push(Object.freeze({ directory: scope.directory, filename, findings: recognized.findings })); continue; }
      const stem = basename(filename, projectFilepathExtension(filename));
      if (seen.has(stem)) { refused.push(Object.freeze({ directory: scope.directory, filename, findings: Object.freeze([finding("duplicate-stem", `duplicate term stem in one scope: ${stem}`)]) })); continue; }
      seen.add(stem);
      const path = `${syntheticScope(depth, scopes.length)}/content/text/glossary/terms/${filename}`;
      documentsByPath.set(path, Object.freeze({ depth, directory: scope.directory, filename, stem, ...recognized }));
      readings.push(Object.freeze({ path, frontmatter: Object.freeze({ name: recognized.name, ...(recognized.keywords.length ? { keywords: recognized.keywords.join(", ") } : {}) }) }));
    }
  }
  const index = resolveMarkdownVaultKeywordIndexFromReadings({ readings });
  const edges = [];
  for (const [fromPath, targets] of Object.entries(index.keywordsByPath)) {
    for (const target of targets) edges.push(frozenEdge(documentsByPath.get(fromPath).stem, documentsByPath.get(target.path).stem, target.keyword));
  }
  const unresolved = index.defects.filter(({ keyword }) => keyword !== undefined).map(({ path, keyword }) => Object.freeze({
    from: documentsByPath.get(path)?.stem ?? path,
    keyword,
    reason: "not-found-in-current-or-ancestor-scope",
  }));
  const reverse = new Map();
  for (const edge of edges) reverse.set(edge.to, Object.freeze([...(reverse.get(edge.to) ?? []), edge.from]));
  return Object.freeze({
    scopes: Object.freeze(scopes.map(({ directory }) => directory)),
    edges: Object.freeze(edges),
    unresolved: Object.freeze(unresolved),
    refused: Object.freeze(refused),
    backlinksFor: (stem) => reverse.get(stem) ?? Object.freeze([]),
  });
}

export function readGlossaryKeywordScopes(startDirectory) {
  return readMarkdownVaultGlossaryScopeReadings(startDirectory);
}

export function indexGlossaryKeywordWebFrom(startDirectory) {
  const scopes = readGlossaryKeywordScopes(startDirectory);
  if (scopes.length === 0) throw new Error(`no current or ancestor glossary term scope found from ${startDirectory}`);
  return indexGlossaryKeywordWeb(scopes);
}
