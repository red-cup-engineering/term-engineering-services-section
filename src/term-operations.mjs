import { existsSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { readFileText } from "@red-cup-engineering/computer-file-engineering-services-section/read-file";
import { writeFileText } from "@red-cup-engineering/computer-file-engineering-services-section/write-file";
import { admitTermMarkdown, readTermMarkdown, recognizeTermMarkdown, renderTermMarkdown } from "./term-carrier.mjs";

export async function readTerm(path) {
  const absolutePath = resolve(path); const text = await readFileText(absolutePath);
  return Object.freeze({ path: absolutePath, text, parsed: readTermMarkdown(text), recognized: recognizeTermMarkdown({ text, filename: basename(absolutePath) }) });
}

/** The three claims a write request's semantic evidence must witness in the body (scripts/write-term.md). */
export const SEMANTIC_EVIDENCE_CLAIMS = Object.freeze(["definition", "distinction", "consequence"]);
const collapsed = (text) => text.replace(/\s+/gu, " ").trim();
/**
 * Admit a write request's semantic evidence: at least one source, every absolute-path source
 * present, and a definition, a distinction and a consequence each witnessed verbatim in the body
 * (whitespace collapsed, so wrapping does not matter). Evidence governs the write and is never
 * written into the carrier.
 * @param {{sources?: string[], claims?: Record<string, string>}} semanticEvidence
 * @param {string} body
 * @param {{sourceExists?: (path: string) => boolean}} [operations]
 */
export function admitSemanticEvidence(semanticEvidence, body, { sourceExists = existsSync } = {}) {
  if (!semanticEvidence || typeof semanticEvidence !== "object") throw new TypeError("semanticEvidence is required: sources and claims.definition, .distinction, .consequence");
  const { sources, claims } = semanticEvidence;
  if (!Array.isArray(sources) || sources.length === 0 || sources.some((source) => typeof source !== "string" || source.trim() === "")) throw new TypeError("semanticEvidence.sources must name at least one source");
  for (const source of sources) if (isAbsolute(source) && !sourceExists(source)) throw new Error(`semantic evidence source does not exist: ${source}`);
  const witnessed = collapsed(String(body ?? ""));
  for (const claim of SEMANTIC_EVIDENCE_CLAIMS) {
    const excerpt = claims?.[claim];
    if (typeof excerpt !== "string" || excerpt.trim() === "") throw new TypeError(`semanticEvidence.claims.${claim} is required`);
    if (!witnessed.includes(collapsed(excerpt))) throw new Error(`semanticEvidence.claims.${claim} is not witnessed in the body`);
  }
}

export async function writeTerm({ termDirectory, term, semanticEvidence, knownCompoundStems = [], authorizedRelationKeys = [], overwrite = false } = {}, operations = {}) {
  if (typeof termDirectory !== "string" || termDirectory.trim() === "") throw new TypeError("termDirectory is required");
  const filename = term?.filename;
  if (typeof filename !== "string" || basename(filename) !== filename || filename === ".md" || !filename.endsWith(".md")) throw new TypeError("term.filename must be one safe Markdown basename; the filename stem is the machine identity");
  const identity = filename.slice(0, -3);
  if (term.identity !== identity) throw new TypeError("term.identity must equal the filename stem");
  const { filename: _filename, ...record } = term;
  admitSemanticEvidence(semanticEvidence, record.body, { sourceExists: operations.sourceExists });
  const markdown = renderTermMarkdown(record, { authorizedRelationKeys }); const path = join(resolve(termDirectory), filename);
  const pathExists = operations.exists ?? existsSync;
  if (pathExists(path) && !overwrite) throw new Error(`term already exists; explicit overwrite required: ${path}`);
  const admitted = admitTermMarkdown({ text: markdown, filename, knownCompoundStems, authorizedRelationKeys });
  const write = operations.write ?? writeFileText;
  await write(path, markdown);
  return Object.freeze({ disposition: "written", path, filename, admitted });
}
