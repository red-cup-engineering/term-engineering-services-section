import { readMarkdownStructure } from "@red-cup-engineering/read-markdown-structure-service";
import { basename, extname as projectFilepathExtension } from "node:path";
import { createMarkdownDocument } from "@red-cup-engineering/markdown-engineering-services-section/create-markdown-document";
import { readMarkdownFrontmatter } from "@red-cup-engineering/read-markdown-frontmatter-service";
import RELATION_PREDICATE_VOCABULARY from "../schemas/glossary/term/relation-predicates.json" with { type: "json" };
import { admitTermRecord } from "../schemas/glossary/term/term.schema.mjs";
import { slugify } from "@red-cup-engineering/computer-text-content-engineering-services-section/slugify-text";

export const FORBIDDEN_TERM_KEYS = Object.freeze(["slug", "defines", "related", "title", "orchestrated-by"]);
export const TERM_KEYS = Object.freeze(["identity", "name", "body", "description", "consent-status", "visibility", "type", "creator", "aliases", "keywords", "relations", "references", "provenance", "status-function"]);
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
  for (const [key, value] of Object.entries(metadata.relations ?? {})) if (value !== null && value !== undefined) relations[key] = value;
  for (const key of Object.keys(metadata)) {
    if (key === "relations" || TERM_KEYS.includes(key) || CARRIER_METADATA_KEYS.includes(key) || !authority.has(key)) continue;
    const value = metadata[key];
    if (value === null || value === undefined) continue;
    if (Object.hasOwn(relations, key) && JSON.stringify(relations[key]) !== JSON.stringify(value)) { findings.push(finding("relation-conflict", `top-level ${key} conflicts with relations.${key}`)); continue; }
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
  if (/\b(?:constituent|component|word)\s+of\b|\bin\s+the\s+(?:phrase|acronym)\b/iu.test(record.body ?? "")) findings.push(finding("circular-definition", "term body must define its concept, not only its position in a compound"));
  const term = findings.length === 0;
  return Object.freeze({ term, admitted: term, ...record, kind: record.keywords?.length ? "compound" : "primitive", findings: Object.freeze(findings) });
}
export function admitTermMarkdown(input) {
  const recognized = recognizeTermMarkdown(input); if (!recognized.admitted) { const error = new Error(`term refused: ${recognized.findings.map(({ rule, message }) => `${rule}: ${message}`).join("; ")}`); error.findings = recognized.findings; throw error; } return recognized;
}

const LEGACY_META = new Set(["id", "title", "domain", "authors", "tags", "cites", "sources", "date-created", "date-modified", "date-updated"]);
export function migrateLegacyTermMarkdown({ text, filename, knownKeywordIdentities } = {}) {
  const parsed = readTermMarkdown(text); const frontmatter = parsed.frontmatter ?? {}; const carrierBody = parsed.body; const identity = filenameIdentity(filename);
  const name = frontmatter.name ?? frontmatter.title ?? frontmatter.id ?? identity;
  const relations = { ...(frontmatter.relations ?? {}) }; for (const [key, value] of Object.entries(frontmatter)) if (!TERM_KEYS.includes(key) && !LEGACY_META.has(key) && AUTHORIZED_RELATION_PREDICATES.includes(key)) relations[key] = value;
  const priorProvenance = frontmatter.provenance ?? {};
  const sources = [...new Set([...(Array.isArray(priorProvenance.sources) ? priorProvenance.sources : []), ...(Array.isArray(frontmatter.sources) ? frontmatter.sources : []), ...(Array.isArray(frontmatter.cites) ? frontmatter.cites : [])].map(String).filter(Boolean))];
  const dateCreated = String(frontmatter["date-created"] ?? priorProvenance["date-created"] ?? "").slice(0, 10); const dateModified = String(frontmatter["date-modified"] ?? frontmatter["date-updated"] ?? priorProvenance["date-modified"] ?? "").slice(0, 10);
  const references = Object.fromEntries(Object.entries(frontmatter.references ?? {}).map(([key, value]) => {
    if (/^[a-z][a-z0-9-]*[0-9]{4}[a-z0-9-]*$/u.test(key)) return [key, value];
    const year = /[0-9]{4}/u.exec(key)?.[0];
    const normalized = year ? `${key.replace(year, "").replace(/[^a-z0-9-]/gu, "")}${year}` : key;
    return [normalized, value];
  }));
  const migratedKeywords = Array.isArray(frontmatter.keywords) ? normalizeKeywords(frontmatter.keywords.map(String)).filter((keyword) => knownKeywordIdentities === undefined || knownKeywordIdentities.has(keyword)) : [];
  const record = {
    identity, name: normalizeTermName(String(name)), body: body(carrierBody),
    ...(frontmatter.description ? { description: normalizeTermDescription(String(frontmatter.description)) } : {}),
    ...(frontmatter.type ? { type: normalizeTermResourceTag(String(frontmatter.type), "type") } : {}),
    ...(frontmatter.creator ? { creator: normalizeTermResourceTag(String(frontmatter.creator), "creator") } : {}),
    ...(Array.isArray(frontmatter.aliases) ? { aliases: normalizeTermAliases(frontmatter.aliases.map(String), { name: String(name) }) } : {}),
    ...(migratedKeywords.length ? { keywords: migratedKeywords } : {}),
    ...(Object.keys(relations).length ? { relations } : {}),
    ...(Object.keys(references).length ? { references } : {}),
    ...((dateCreated || dateModified || sources.length) ? { provenance: { ...(dateCreated ? { "date-created": dateCreated } : {}), ...(dateModified ? { "date-modified": dateModified } : {}), ...(sources.length ? { sources } : {}) } } : {}),
  };
  const markdown = renderTermMarkdown(record); const recognized = recognizeTermMarkdown({ text: markdown, filename });
  if (!recognized.admitted) throw new Error(`migrated term ${filename} did not admit: ${recognized.findings.map(({ message }) => message).join("; ")}`);
  return Object.freeze({ record, markdown, removedKeys: Object.freeze(Object.keys(frontmatter).filter((key) => !TERM_KEYS.includes(key) && !(key in relations))) });
}
