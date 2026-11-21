import { isDeepStrictEqual } from "node:util";
import { readMarkdownStructure } from "@red-cup-engineering/markdown-engineering-services-section/read-markdown-structure";
import { basename, extname as projectFilepathExtension } from "node:path";
import { createMarkdownDocument } from "@red-cup-engineering/markdown-engineering-services-section/create-markdown-document";
import { readMarkdownFrontmatter } from "@red-cup-engineering/markdown-engineering-services-section/read-markdown-frontmatter";
import { splitMarkdownFrontmatterFence } from "@red-cup-engineering/markdown-engineering-services-section/split-markdown-frontmatter-fence";
import RELATION_PREDICATE_VOCABULARY from "../schemas/glossary/term/relation-predicates.json" with { type: "json" };
import { TERM_RECORD_SCHEMA, admitTermRecord } from "../schemas/glossary/term/term.schema.mjs";
import { slugify } from "@red-cup-engineering/computer-text-content-engineering-services-section/slugify-text";

export const FORBIDDEN_TERM_KEYS = Object.freeze(["slug", "defines", "related", "title", "orchestrated-by"]);
/** The canonical Draft 2020-12 term type owns the exact admitted field vocabulary. */
export const TERM_KEYS = Object.freeze(Object.keys(TERM_RECORD_SCHEMA.properties));
/** Carrier bookkeeping keys a term frontmatter may state at top level; the admission path folds them into `provenance` rather than refusing them as unknown or admitting them as relations. `type` is excluded: it is its own first-class TERM_KEYS entry now, not carrier bookkeeping. */
export const CARRIER_METADATA_KEYS = Object.freeze(["date-created", "date-modified", "date-updated", "authors", "tags", "status", "id", "domain", "scheme"]);
/** FARS status-function declaration keys (2026-04-08 note on FARS algebraic readings of work terms) a term frontmatter may state at top level; the admission path folds them into `status-function` rather than refusing them as unknown, admitting them as relations, or dropping them. */
export const STATUS_FUNCTION_KEYS = Object.freeze(["params", "ast", "output"]);

/** Flat predicate list, unchanged in shape for every existing caller (`.includes`, spread, `new Set`). */
export const AUTHORIZED_RELATION_PREDICATES = Object.freeze(Object.keys(RELATION_PREDICATE_VOCABULARY));
/** Predicate name to its declared range: `"carrier"` (object is another carrier's identity) or `"literal"` (object is a plain string/measurement). */
export const RELATION_PREDICATE_RANGES = Object.freeze(
  Object.fromEntries(Object.entries(RELATION_PREDICATE_VOCABULARY).map(([predicate, { range }]) => [predicate, range])),
);
/**
 * The declared range of an authorized relation predicate.
 * @param {string} predicate
 * @returns {"carrier"|"literal"|undefined} undefined when `predicate` is not authorized
 */
export function relationPredicateRange(predicate) { return RELATION_PREDICATE_RANGES[predicate]; }

function line(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} must be nonempty text`);
  const normalized = value.replace(/\r\n?/gu, "\n").trim().replace(/[\t ]+/gu, " ");
  if (normalized.includes("\n")) throw new TypeError(`${label} must occupy one line`);
  return normalized;
}
export function normalizeTermName(value) { return line(value, "name"); }
export function termStem(value) {
  // "&" and apostrophes are term-domain-specific law (spelled out, dropped)
  // that the generic slugify-text founding does not and should not carry;
  // everything after that (NFKD diacritic-stripping, lowercasing, collapsing
  // to hyphens) is the same transformation every other slug site needs.
  const spelledOut = normalizeTermName(value).replace(/&/gu, " and ").replace(/[\u2019']/gu, "");
  const stem = slugify(spelledOut);
  if (!stem) throw new TypeError("name must produce a filename identity");
  return stem;
}
export function normalizeTermAliases(value = [], { name } = {}) {
  if (!Array.isArray(value)) throw new TypeError("aliases must be an array");
  const primary = name === undefined ? null : normalizeTermName(name).toLowerCase(); const seen = new Set();
  return Object.freeze(value.map((item) => line(item, "alias")).filter((alias) => {
    const key = alias.toLowerCase(); if (key === primary) return false; if (seen.has(key)) return false; seen.add(key); return true;
  }));
}
export function normalizeKeywords(value = []) {
  if (!Array.isArray(value)) throw new TypeError("keywords must be an array");
  return Object.freeze([...new Set(value.map((item) => termStem(line(item, "keyword"))))]);
}
export function normalizeTermDescription(value) { return value === undefined ? undefined : line(value, "description"); }
export function normalizeConsentStatus(value) { return value === undefined ? undefined : line(value, "consent-status"); }
export function normalizeTermResourceTag(value, label) { return value === undefined ? undefined : line(value, label); }

function relationAuthority(value = AUTHORIZED_RELATION_PREDICATES) {
  if (!Array.isArray(value) && !(value instanceof Set)) throw new TypeError("authorizedRelationKeys must be a vocabulary");
  const globallyAuthorized = new Set(AUTHORIZED_RELATION_PREDICATES);
  return new Set([...value].filter((key) => globallyAuthorized.has(key)));
}
// Admission and observation use the same predicate discovery, but do not
// collapse source evidence or silently choose a conflicting declaration.
function* relationDeclarations(metadata, authority) {
  for (const [key, value] of Object.entries(metadata.relations ?? {}))
    yield { key, value, placement: "relations" };
  for (const [key, value] of Object.entries(metadata)) {
    if (key === "relations" || TERM_KEYS.includes(key) || CARRIER_METADATA_KEYS.includes(key) || !authority.has(key)) continue;
    yield { key, value, placement: "frontmatter" };
  }
}

/**
 * Observe relation strings in an already parsed Term carrier. Preserve raw
 * spelling, declaration placement and list order, even when strict admission
 * refuses the carrier. An unknown nested predicate is evidence, not authority.
 * Pass only the normalized relations of a separately admitted Term record;
 * without them no observation matches admission. This does not resolve a
 * target, grant access or merge reviewed source claims.
 *
 * @param {{frontmatter?: Record<string, unknown>, admittedRelations?: Record<string, string|string[]>}} input
 * @returns {ReadonlyArray<Readonly<{key: string, raw: string, placement: string, range: "carrier"|"literal"|null, admittedValue: string|null}>>}
 */
export function observeTermRelations({ frontmatter = {}, admittedRelations = {} } = {}) {
  const authority = relationAuthority();
  const observations = [];
  for (const { key, value, placement } of relationDeclarations(frontmatter ?? {}, authority)) {
    const range = authority.has(key) ? relationPredicateRange(key) : null;
    const held = Object.hasOwn(admittedRelations, key) ? admittedRelations[key] : undefined;
    const admitted = Array.isArray(held) ? held : [held];
    for (const raw of Array.isArray(value) ? value : [value]) {
      if (typeof raw !== "string") continue;
      let admittedValue = null;
      if (range && held !== undefined) {
        try {
          const candidate = line(raw, `relation ${key}`);
          if (admitted.includes(candidate)) admittedValue = candidate;
        } catch {
          // A noncanonical string is still source evidence.
        }
      }
      observations.push(Object.freeze({ key, raw, placement, range, admittedValue }));
    }
  }
  return Object.freeze(observations);
}

function normalizeRelationValue(value, key) {
  const values = Array.isArray(value) ? value : [value];
  if (!values.length) throw new TypeError(`relation ${key} must have an assertion`);
  const normalized = values.map((item) => line(String(item), `relation ${key}`));
  return Array.isArray(value) ? Object.freeze([...new Set(normalized)]) : normalized[0];
}
export function normalizeTermRelations(value = {}, { authorizedRelationKeys = AUTHORIZED_RELATION_PREDICATES } = {}) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("relations must be an object");
  const authority = relationAuthority(authorizedRelationKeys); const output = {};
  for (const [key, assertion] of Object.entries(value)) {
    if (!authority.has(key)) throw new RangeError(`term relation predicate is not authorized: ${key}`);
    output[key] = normalizeRelationValue(assertion, key);
  }
  return Object.freeze(output);
}
function body(value) { if (typeof value !== "string" || value.trim() === "") throw new TypeError("body must be nonempty text"); return value.replace(/\r\n?/gu, "\n").trim(); }
function filenameIdentity(filename) {
  const file = basename(filename ?? ""); if (file !== filename || projectFilepathExtension(file).toLowerCase() !== ".md" || file === ".md") throw new TypeError("filename must be one safe Markdown basename"); return file.slice(0, -3);
}

export function renderTermMarkdown(input = {}, { authorizedRelationKeys = AUTHORIZED_RELATION_PREDICATES } = {}) {
  const admitted = admitTermRecord(input);
  const directAssertions = Object.fromEntries(Object.entries(admitted).filter(([key]) => !TERM_KEYS.includes(key)));
  const record = {
    ...directAssertions,
    identity: admitted.identity,
    name: normalizeTermName(admitted.name),
    ...(admitted.description === undefined ? {} : { description: normalizeTermDescription(admitted.description) }),
    ...(admitted["consent-status"] === undefined ? {} : { "consent-status": normalizeConsentStatus(admitted["consent-status"]) }),
    ...(admitted.visibility === undefined ? {} : { visibility: admitted.visibility }),
    ...(admitted.type === undefined ? {} : { type: normalizeTermResourceTag(admitted.type, "type") }),
    ...(admitted.creator === undefined ? {} : { creator: normalizeTermResourceTag(admitted.creator, "creator") }),
    ...(admitted.aliases?.length ? { aliases: normalizeTermAliases(admitted.aliases, { name: admitted.name }) } : {}),
    ...(admitted.keywords?.length ? { keywords: normalizeKeywords(admitted.keywords) } : {}),
    ...(admitted.relations && Object.keys(admitted.relations).length ? { relations: normalizeTermRelations(admitted.relations, { authorizedRelationKeys }) } : {}),
    ...(admitted.references && Object.keys(admitted.references).length ? { references: admitted.references } : {}),
    ...(admitted.provenance && Object.keys(admitted.provenance).length ? { provenance: admitted.provenance } : {}),
    ...(admitted["status-function"] && Object.keys(admitted["status-function"]).length ? { "status-function": admitted["status-function"] } : {}),
    body: `${body(admitted.body)}\n`,
  };
  return createMarkdownDocument(record, { semanticLinefeeds: false });
}
export function readTermMarkdown(text) {
  // An explicit fence holding no YAML is a YAML null, not an empty term record; only an absent fence defaults.
  const fence = typeof text === "string" ? splitMarkdownFrontmatterFence(text) : null;
  if (fence?.format === "yaml" && fence.raw.trim() === "") throw new TypeError("term frontmatter fence is empty: an explicit YAML null is not a term record");
  const parsed = readMarkdownFrontmatter(text, { frontmatterFormats: ["yaml"], jsonObjectFrontmatter: false });
  return Object.freeze({ frontmatter: parsed.frontmatter, body: parsed.body });
}
function finding(rule, message) { return Object.freeze({ rule, message }); }

/**
 * The record's carrier identity: the explicit `identity` if the frontmatter states one, else
 * the filename stem. An explicit identity must equal the stem when a filename is known.
 * @param {Record<string, unknown>} metadata
 * @param {string|undefined} filename
 * @param {Array<{rule: string, message: string}>} findings mutated with an "identity" or "filename" finding
 * @returns {string|undefined}
 */
function deriveIdentity(metadata, filename, findings) {
  let stem;
  if (filename !== undefined) {
    try { stem = filenameIdentity(filename); }
    catch (error) { findings.push(finding("filename", error.message)); }
  }
  if (metadata.identity === undefined) return stem;
  if (stem !== undefined && metadata.identity !== stem) findings.push(finding("identity", "identity must equal the Markdown filename stem"));
  return metadata.identity;
}

/**
 * Fold carrier bookkeeping keys (CARRIER_METADATA_KEYS) stated at frontmatter top level into
 * one `provenance` object, alongside any explicit `provenance` map already present. A top-level
 * key that disagrees with an explicit `provenance` entry of the same name is a finding, never a
 * silent drop.
 * @param {Record<string, unknown>} metadata
 * @param {Array<{rule: string, message: string}>} findings mutated with a "provenance-conflict" finding
 * @returns {Record<string, unknown>}
 */
function foldCarrierMetadata(metadata, findings) {
  const provenance = {};
  for (const [key, value] of Object.entries(metadata.provenance ?? {})) if (value !== null && value !== undefined) provenance[key] = value;
  for (const key of CARRIER_METADATA_KEYS) {
    const value = metadata[key];
    if (value === null || value === undefined) continue;
    if (Object.hasOwn(provenance, key) && JSON.stringify(provenance[key]) !== JSON.stringify(value)) { findings.push(finding("provenance-conflict", `top-level ${key} conflicts with provenance.${key}`)); continue; }
    provenance[key] = value;
  }
  return provenance;
}

/**
 * Fold authorized relation predicates stated at frontmatter top level (the corpus convention,
 * e.g. `requires: [light]` as a sibling of `name:`) into one `relations` object, alongside any
 * explicit nested `relations:` map already present. A top-level key that disagrees with an
 * explicit `relations` entry of the same name is a finding, never a silent drop.
 * @param {Record<string, unknown>} metadata
 * @param {Set<string>} authority predicates authorized for this admission
 * @param {Array<{rule: string, message: string}>} findings mutated with a "relation-conflict" finding
 * @returns {Record<string, unknown>}
 */
function foldTopLevelRelations(metadata, authority, findings) {
  const relations = {};
  for (const { key, value, placement } of relationDeclarations(metadata, authority)) {
    if (value === null || value === undefined) continue;
    if (placement === "frontmatter" && Object.hasOwn(relations, key) && JSON.stringify(relations[key]) !== JSON.stringify(value)) {
      findings.push(finding("relation-conflict", `top-level ${key} conflicts with relations.${key}`));
      continue;
    }
    relations[key] = value;
  }
  return relations;
}

/**
 * Fold FARS status-function declaration keys (STATUS_FUNCTION_KEYS) stated at frontmatter top
 * level into one `status-function` object, alongside any explicit nested `status-function:` map
 * already present. A top-level key that disagrees with an explicit `status-function` entry of
 * the same name is a finding, never a silent drop.
 * @param {Record<string, unknown>} metadata
 * @param {Array<{rule: string, message: string}>} findings mutated with a "status-function-conflict" finding
 * @returns {Record<string, unknown>}
 */
function foldStatusFunction(metadata, findings) {
  const statusFunction = {};
  for (const [key, value] of Object.entries(metadata["status-function"] ?? {})) if (value !== null && value !== undefined) statusFunction[key] = value;
  for (const key of STATUS_FUNCTION_KEYS) {
    const value = metadata[key];
    if (value === null || value === undefined) continue;
    if (Object.hasOwn(statusFunction, key) && JSON.stringify(statusFunction[key]) !== JSON.stringify(value)) { findings.push(finding("status-function-conflict", `top-level ${key} conflicts with status-function.${key}`)); continue; }
    statusFunction[key] = value;
  }
  return statusFunction;
}

/**
 * The carrier's first Markdown H1 heading text (outside any fence), or undefined when none.
 * @param {string} body
 * @returns {string|undefined}
 */
function firstMarkdownHeading(body) {
  return readMarkdownStructure(body ?? "").headings.find(({ level, title }) => level === 1 && title !== "")?.title;
}
/**
 * The ruled default carrier name: the first H1 heading text in the body when the frontmatter
 * states no explicit name, else the identity with hyphens turned to spaces.
 * @param {string} body
 * @param {string|undefined} identity
 * @returns {string|undefined}
 */
function defaultTermName(body, identity) {
  const heading = firstMarkdownHeading(body);
  if (heading !== undefined) return heading;
  return identity === undefined ? undefined : identity.replace(/-/gu, " ");
}

export function recognizeTermMarkdown({ text, filename, authorizedRelationKeys = AUTHORIZED_RELATION_PREDICATES } = {}) {
  let parsed; try { parsed = readTermMarkdown(text); } catch (error) { return Object.freeze({ term: false, admitted: false, findings: Object.freeze([finding("markdown", error.message)]) }); }
  return recognizeTermDocument({ frontmatter: parsed.frontmatter, body: parsed.body, filename, authorizedRelationKeys });
}
/**
 * Recognize a term from an already-parsed carrier (its frontmatter object and Markdown body), as
 * a vault room or any other reader that has parsed the file holds it. Same rules and result as
 * `recognizeTermMarkdown`, which parses and then calls this.
 * @param {{frontmatter?: Record<string, unknown>, body?: string, filename?: string, authorizedRelationKeys?: Iterable<string>}} document
 */
export function recognizeTermDocument({ frontmatter, body: markdownBody = "", filename, authorizedRelationKeys = AUTHORIZED_RELATION_PREDICATES } = {}) {
  const parsed = { frontmatter, body: typeof markdownBody === "string" ? markdownBody : "" };
  const findings = []; const metadata = parsed.frontmatter ?? {};
  const authority = relationAuthority(authorizedRelationKeys);
  for (const key of Object.keys(metadata)) if (!TERM_KEYS.includes(key) && !CARRIER_METADATA_KEYS.includes(key) && !STATUS_FUNCTION_KEYS.includes(key) && !authority.has(key)) findings.push(finding("unknown-key", `term frontmatter does not admit ${key}`));
  const identity = deriveIdentity(metadata, filename, findings);
  const provenance = foldCarrierMetadata(metadata, findings);
  const relations = foldTopLevelRelations(metadata, authority, findings);
  const statusFunction = foldStatusFunction(metadata, findings);
  const record = { ...metadata, identity, body: parsed.body.trim() };
  for (const key of CARRIER_METADATA_KEYS) delete record[key];
  for (const key of STATUS_FUNCTION_KEYS) delete record[key];
  for (const key of authority) delete record[key];
  if (Object.keys(provenance).length > 0) record.provenance = provenance; else delete record.provenance;
  if (Object.keys(statusFunction).length > 0) record["status-function"] = statusFunction; else delete record["status-function"];
  if (record.name === undefined || (typeof record.name === "string" && record.name.trim() === "")) {
    const defaulted = defaultTermName(record.body, identity);
    if (defaulted !== undefined) record.name = defaulted;
  }
  try {
    record.name = normalizeTermName(record.name); record.aliases = normalizeTermAliases(record.aliases, { name: record.name }); record.keywords = normalizeKeywords(record.keywords);
    record.description = normalizeTermDescription(record.description); record["consent-status"] = normalizeConsentStatus(record["consent-status"]);
    record.relations = normalizeTermRelations(relations, { authorizedRelationKeys });
    admitTermRecord(record);
  } catch (error) { findings.push(finding("record", error.message)); }
  const term = findings.length === 0;
  return Object.freeze({ term, admitted: term, ...record, kind: record.keywords?.length ? "compound" : "primitive", findings: Object.freeze(findings) });
}
export function admitTermMarkdown(input) {
  const recognized = recognizeTermMarkdown(input); if (!recognized.admitted) { const error = new Error(`term refused: ${recognized.findings.map(({ rule, message }) => `${rule}: ${message}`).join("; ")}`); error.findings = recognized.findings; throw error; } return recognized;
}

/** A refusal is not permission to rewrite the original research carrier. */
function migrationRefusal(filename, findings) {
  const error = new Error(`term migration refused for ${filename}: ${findings.map(item => item.message).join("; ")}`);
  error.code = "ERR_TERM_MIGRATION_REFUSED";
  error.findings = Object.freeze([...findings]);
  return error;
}

/**
 * Migrate only a byte-preserving, unambiguous legacy title spelling. Admitted
 * carriers are exact no-ops. Unknown metadata, conflicts, unsupported YAML
 * spelling, and any remaining schema refusal need source-owner review. The
 * migration batch is not the vocabulary and does not filter retrieval keys.
 */
export function migrateLegacyTermMarkdown({ text, filename } = {}) {
  const original = recognizeTermMarkdown({ text, filename });
  if (original.admitted) return Object.freeze({ record: original, markdown: text, removedKeys: Object.freeze([]) });

  const fence = typeof text === "string" ? splitMarkdownFrontmatterFence(text) : null;
  let metadata;
  try { metadata = readTermMarkdown(text).frontmatter ?? {}; }
  catch { throw migrationRefusal(filename, original.findings); }
  if (fence?.format !== "yaml" || typeof metadata.title !== "string" ||
      Object.hasOwn(metadata, "name") || !original.findings.some(item => item.rule === "unknown-key" &&
        item.message === "term frontmatter does not admit title"))
    throw migrationRefusal(filename, original.findings);

  // Edit the key token only. Reparse to rule out YAML block scalar, mapping,
  // duplicate-token or quoting cases that don't mean this exact field rename.
  const tokens = [...fence.raw.matchAll(/^title(?=:[ \t])/gmu)];
  if (tokens.length !== 1) throw migrationRefusal(filename, [...original.findings,
    finding("metadata-spelling", "can only rename one unquoted top-level title key")]);
  const offset = fence.source.rawStart + tokens[0].index;
  const markdown = text.slice(0, offset) + "name" + text.slice(offset + "title".length);
  const after = splitMarkdownFrontmatterFence(markdown);
  const { title, ...rest } = metadata;
  let updated;
  try { updated = readTermMarkdown(markdown).frontmatter; }
  catch { throw migrationRefusal(filename, original.findings); }
  if (!isDeepStrictEqual(updated, { ...rest, name: title }) || after?.body !== fence.body)
    throw migrationRefusal(filename, [finding("source-preservation", "metadata or body would change beyond the approved key rename")]);

  const record = recognizeTermMarkdown({ text: markdown, filename });
  if (!record.admitted) throw migrationRefusal(filename, record.findings);
  return Object.freeze({ record, markdown, removedKeys: Object.freeze(["title"]) });
}
