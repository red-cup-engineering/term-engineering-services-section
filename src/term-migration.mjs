import { projectMarkdownFeatures } from "@red-cup-engineering/read-markdown-features-service";
import { replaceMarkdownLinkTarget } from "@red-cup-engineering/markdown-engineering-services-section/replace-markdown-link-target";
import { readMarkdownSource, readMarkdownStructure } from "@red-cup-engineering/read-markdown-structure-service";
import { basename, extname } from "node:path";
import { mutateMarkdownFrontmatter } from "@red-cup-engineering/markdown-engineering-services-section/mutate-markdown-frontmatter";
import { readMarkdownFrontmatter } from "@red-cup-engineering/read-markdown-frontmatter-service";
import { migrateLegacyTermMarkdown, normalizeTermAliases, normalizeTermDescription, normalizeTermName, readTermMarkdown, renderTermMarkdown, termStem } from "./term-carrier.mjs";
import { sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";

const humanize = (value) => value.replace(/[-_]+/gu, " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());

/** The label strings an alias-bearing frontmatter value states: a list, or Org-roam's quoted or bracketed string form. */
function aliasValues(value) {
  return (Array.isArray(value) ? value : (() => {
    if (typeof value !== "string" || value.trim() === "") return [];
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [parsed]; } catch {}
    return value.replace(/^\[|\]$/gu, "").split(",");
  })()).map(String).map((item) => item.replace(/^['"]|['"]$/gu, "").trim()).filter(Boolean);
}

function aliasesFrom(metadata, name) {
  return normalizeTermAliases([metadata.aliases, metadata.alias, metadata.roam_alias, metadata.roam_aliases].flatMap(aliasValues), { name });
}

export function rewriteMigratedTermLinks(body, stemMap) {
  if (!(stemMap instanceof Map)) throw new TypeError("stemMap must be a Map");
  const targets = new Set(projectMarkdownFeatures(readMarkdownSource(body)).filter(({ type }) => type === "markdown-link").map(({ target }) => target));
  const edits = [];
  for (const target of targets) {
    const fragmentIndex = target.indexOf("#");
    const fragment = fragmentIndex < 0 ? "" : target.slice(fragmentIndex);
    const path = (fragmentIndex < 0 ? target : target.slice(0, fragmentIndex)).replace(/\.(?:md|org)$/u, "");
    const next = stemMap.get(path) ?? stemMap.get(basename(path));
    if (next) edits.push(...replaceMarkdownLinkTarget(body, { target, replacement: `${next}.md${fragment}` }).edits);
  }
  // All replacements derive from the original carrier, so rename chains cannot cascade.
  let output = body;
  for (const { span, replacement } of edits.sort((left, right) => right.span.start - left.span.start)) {
    output = output.slice(0, span.start) + replacement + output.slice(span.end);
  }
  return output.replace(/\[\[file:([^\]]+?)(?:\.org)?\](?:\[([^\]]+)\])?\]/gu, (whole, target, label) => {
    const next = stemMap.get(target) ?? stemMap.get(basename(target));
    return next ? `[${label ?? target}](${next}.md)` : whole;
  });
}

function sourceView(source, convertOrgToGfm) {
  if (!source || typeof source.relativePath !== "string" || typeof source.text !== "string") throw new TypeError("migration source requires relativePath and text");
  const format = source.format ?? extname(source.relativePath).slice(1).toLowerCase();
  if (!new Set(["md", "org"]).has(format)) throw new TypeError(`unsupported term source format: ${format}`);
  if (format === "md") {
    const parsed = readTermMarkdown(source.text);
    return { format, metadata: parsed.frontmatter ?? {}, body: parsed.body };
  }
  if (typeof convertOrgToGfm !== "function") throw new TypeError("Org migration requires the upstream Org-to-GFM conversion operation");
  if (!source.metadata || typeof source.metadata !== "object" || Array.isArray(source.metadata)) throw new TypeError("Org migration requires metadata decoded by its owning format service");
  const body = convertOrgToGfm(source.text);
  if (typeof body !== "string" || (source.text.trim() && !body.trim())) throw new Error(`Org conversion lost substantive content: ${source.relativePath}`);
  return { format, metadata: source.metadata, body };
}

/** Plan a loss-accounted migration without mutating sources or destinations. */
export function planTermMigration(sources, { convertOrgToGfm, relationKeysBySource = {} } = {}) {
  if (!Array.isArray(sources) || sources.length === 0) throw new TypeError("migration requires sources");
  const primaries = sources.filter((source) => source.role !== "alternate-witness");
  const alternates = sources.filter((source) => source.role === "alternate-witness");
  const prepared = primaries.map((source) => {
    const view = sourceView(source, convertOrgToGfm); const metadata = view.metadata;
    const name = normalizeTermName(metadata.name ?? metadata.title ?? metadata.defines ?? humanize(basename(source.relativePath, extname(source.relativePath))));
    return { source, view, name, filename: `${source.targetStem ?? basename(source.relativePath, extname(source.relativePath))}.md` };
  });
  const byFilename = new Map();
  for (const item of prepared) {
    const group = [...(byFilename.get(item.filename) ?? []), item]; byFilename.set(item.filename, group);
  }
  const collisions = [...byFilename.entries()].filter(([, group]) => group.length > 1);
  if (collisions.length) throw new Error(`term migration collision: ${collisions.map(([file, group]) => `${file} <= ${group.map((item) => item.source.relativePath).join(", ")}`).join("; ")}`);
  const stemMap = new Map(prepared.map(({ source, filename }) => [basename(source.relativePath, extname(source.relativePath)), basename(filename, ".md")]));
  const transactions = prepared.map(({ source, view, name, filename }) => {
    const aliases = aliasesFrom(view.metadata, name);
    const description = view.metadata.description === undefined ? undefined : normalizeTermDescription(String(view.metadata.description));
    const body = rewriteMigratedTermLinks(view.body, stemMap);
    const authorizedRelationKeys = relationKeysBySource instanceof Map
      ? relationKeysBySource.get(source.relativePath) ?? []
      : relationKeysBySource[source.relativePath] ?? [];
    const relations = Object.fromEntries(authorizedRelationKeys.filter((key) => Object.hasOwn(view.metadata, key)).map((key) => [key, view.metadata[key]]));
    const identity = basename(filename, ".md");
    const legacy = migrateLegacyTermMarkdown({ text: source.text, filename: `${basename(source.relativePath, extname(source.relativePath))}.md` }).record;
    const markdown = renderTermMarkdown({ ...legacy, identity, name, aliases, description, relations, body }, { authorizedRelationKeys });
    return { source: source.relativePath, sourceSha256: sha256Hex(source.text), sourceFormat: view.format, output: filename, outputSha256: sha256Hex(markdown), markdown, disposition: "requires-semantic-admission" };
  });
  for (const witness of alternates) {
    if (typeof witness.alternateFor !== "string") throw new Error(`alternate witness lacks alternateFor: ${witness.relativePath}`);
    const transaction = transactions.find((item) => item.output === witness.alternateFor);
    if (!transaction) throw new Error(`alternate witness has no target: ${witness.relativePath} -> ${witness.alternateFor}`);
    transaction.alternateWitnesses = Object.freeze([...(transaction.alternateWitnesses ?? []), Object.freeze({ source: witness.relativePath, sourceSha256: sha256Hex(witness.text), disposition: "witnessed-out-of-carrier" })]);
  }
  return Object.freeze({ schema: "computer-glossary-term-migration.v1", transactions: Object.freeze(transactions.map(Object.freeze)), invariants: Object.freeze(["sources unchanged", "alternate provenance stays outside term metadata", "materialization requires semantic admission"]) });
}

export function verifyMigrationMaterialization(plan, observed) {
  if (plan?.schema !== "computer-glossary-term-migration.v1" || !(observed instanceof Map)) throw new TypeError("plan and observed Map are required");
  const errors = [];
  for (const transaction of plan.transactions) {
    const value = observed.get(transaction.output);
    if (value === undefined) errors.push(`missing output: ${transaction.output}`);
    else if (sha256Hex(value) !== transaction.outputSha256) errors.push(`output hash mismatch: ${transaction.output}`);
  }
  for (const output of observed.keys()) if (!plan.transactions.some((item) => item.output === output)) errors.push(`unreceipted output: ${output}`);
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function prepareDescriptionBridge(documents, { maximumContextCharacters = 6000 } = {}) {
  if (!Array.isArray(documents) || !Number.isSafeInteger(maximumContextCharacters) || maximumContextCharacters < 1) throw new TypeError("documents and positive context bound required");
  return Object.freeze(documents.map(({ filename, text }) => {
    const parsed = readTermMarkdown(text); const name = normalizeTermName(parsed.frontmatter?.name);
    const aliases = normalizeTermAliases(parsed.frontmatter?.aliases, { name });
    return Object.freeze({ source: filename, sourceSha256: sha256Hex(text), name, aliases, context: parsed.body.trim().slice(0, maximumContextCharacters) });
  }).sort((left, right) => left.source.localeCompare(right.source, "en")));
}

export function seatDescriptionOverlay(documents, proposals) {
  const requests = prepareDescriptionBridge(documents); const sourceDocuments = new Map(documents.map((document) => [document.filename, document.text]));
  const bySource = new Map();
  for (const proposal of proposals) {
    if (bySource.has(proposal.source)) throw new Error(`multiple description proposals: ${proposal.source}`);
    bySource.set(proposal.source, proposal);
  }
  const outputs = new Map(), receipts = [];
  for (const request of requests) {
    const proposal = bySource.get(request.source);
    if (!proposal) throw new Error(`missing description proposal: ${request.source}`);
    if (proposal.sourceSha256 !== request.sourceSha256 || proposal.name !== request.name || JSON.stringify(proposal.aliases ?? []) !== JSON.stringify(request.aliases)) throw new Error(`description proposal witness mismatch: ${request.source}`);
    const description = normalizeTermDescription(proposal.description); const parsed = readTermMarkdown(sourceDocuments.get(request.source));
    const output = renderTermMarkdown({ ...parsed.frontmatter, description, body: parsed.body });
    outputs.set(request.source, output);
    receipts.push(Object.freeze({ source: request.source, sourceSha256: request.sourceSha256, descriptionSha256: sha256Hex(description), outputSha256: sha256Hex(output) }));
  }
  for (const source of bySource.keys()) if (!sourceDocuments.has(source)) throw new Error(`proposal has no source: ${source}`);
  return Object.freeze({ schema: "computer-glossary-term-description-overlay.v1", outputs, receipts: Object.freeze(receipts) });
}

const ALWAYS_DELETE_KEYS = Object.freeze(["slug", "defines", "related", "orchestrated-by", "orchestrates"]);
const GENERATED_PATH_SEGMENTS = new Set([".git", ".cache", "build", "coverage", "dist", "generated", "node_modules"]);

/** Classify a repository-relative Markdown path before it enters a corpus plan. */
export function classifyMarkdownCorpusPath(relativePath, { ignored = false } = {}) {
  if (typeof relativePath !== "string" || relativePath === "") throw new TypeError("relativePath is required");
  const segments = relativePath.replaceAll("\\", "/").split("/").filter(Boolean);
  if (ignored) return Object.freeze({ included: false, reason: "ignored-by-repository" });
  const excludedSegment = segments.find((segment) => GENERATED_PATH_SEGMENTS.has(segment));
  if (excludedSegment !== undefined) {
    return Object.freeze({ included: false, reason: excludedSegment === "node_modules" ? "dependency-tree" : "generated-tree", segment: excludedSegment });
  }
  if (extname(segments.at(-1) ?? "").toLowerCase() !== ".md") return Object.freeze({ included: false, reason: "not-markdown" });
  return Object.freeze({ included: true, termDirectory: segments.slice(0, -1).some((segment) => segment === "term" || segment === "terms") });
}

function deleteKey(text, key, actions) {
  if (!text.includes(key)) return text;
  const next = mutateMarkdownFrontmatter(text, { mode: "delete", keys: [key] });
  if (next !== text) actions.push(Object.freeze({ operation: "delete-frontmatter-key", key }));
  return next;
}

function hasTopLevelKey(text, key) {
  if (!text.includes(key)) return false;
  return mutateMarkdownFrontmatter(text, { mode: "delete", keys: [key] }) !== text;
}

function deleteKeyOnlyWhenEqual(text, key, value, actions) {
  if (!hasTopLevelKey(text, key)) return text;
  const observed = readMarkdownFrontmatter(text).frontmatter?.[key];
  if (observed !== value) return text;
  const next = mutateMarkdownFrontmatter(text, { mode: "delete", keys: [key] });
  actions.push(Object.freeze({ operation: "delete-frontmatter-key-value", key, value }));
  return next;
}

function frontmatterHandles(text) {
  try {
    const frontmatter = readMarkdownFrontmatter(text).frontmatter ?? {};
    return [...new Set([frontmatter.name, frontmatter.title].filter((value) => typeof value === "string" && value.trim() !== ""))];
  } catch {
    return [];
  }
}

function removeRepeatedOutsideFenceH1(text, handles) {
  const accepted = new Set(handles);
  const headings = handles.length === 0 ? [] : readMarkdownStructure(text).headings.filter(({ level, title }) => level === 1 && accepted.has(title));
  if (headings.length === 0) return Object.freeze({ text, removals: Object.freeze([]), preserved: true });
  // Canonical line coordinates select complete original lines, retaining every other byte.
  const lines = [...text.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/gu)].filter(({ 0: line }) => line !== "");
  const pieces = [], removals = [];
  let cursor = 0, witnessedBytes = 0;
  for (const heading of headings) {
    const start = lines[heading.line - 1].index;
    const last = lines[heading.declarationEndLine - 1];
    const end = last.index + last[0].length;
    pieces.push(text.slice(cursor, start));
    cursor = end;
    witnessedBytes += Buffer.byteLength(text.slice(start, end));
    removals.push(Object.freeze({ operation: "remove-repeated-h1", handle: heading.title, line: heading.line }));
  }
  pieces.push(text.slice(cursor));
  const output = pieces.join("");
  return Object.freeze({ text: output, removals: Object.freeze(removals), preserved: Buffer.byteLength(text) - Buffer.byteLength(output) === witnessedBytes });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const EMBEDDED_ISO_DATE = /\d{4}-\d{2}-\d{2}/u;
const DATE_FRONTMATTER_KEYS = Object.freeze(["date-created", "date-modified", "date-updated"]);

/**
 * The ISO date embedded in a wiki-linked, quoted, or timestamped frontmatter date value (e.g.
 * `[[2025-04-27]]`, `2026-03-03T00:00:00`). Returns null when the value is already a bare ISO
 * date (nothing to normalize) or carries no ISO date substring at all (a refusal the contract
 * keeps).
 * @param {unknown} value
 * @returns {string|null}
 */
export function extractIsoDateFromFrontmatterValue(value) {
  if (typeof value !== "string") return null;
  if (ISO_DATE.test(value)) return null;
  const match = EMBEDDED_ISO_DATE.exec(value);
  return match ? match[0] : null;
}

/** Rewrite every date-created/date-modified/date-updated top-level value with an embedded but non-bare ISO date to that bare ISO date, recording one action per key changed. */
function normalizeDateFrontmatterValues(text, actions) {
  let output = text;
  for (const key of DATE_FRONTMATTER_KEYS) {
    if (!hasTopLevelKey(output, key)) continue;
    const current = readMarkdownFrontmatter(output).frontmatter?.[key];
    const isoDate = extractIsoDateFromFrontmatterValue(current);
    if (isoDate === null) continue;
    output = mutateMarkdownFrontmatter(output, { mode: "set", key, value: isoDate });
    actions.push(Object.freeze({ operation: "normalize-date-frontmatter-value", key, from: current, to: isoDate }));
  }
  return output;
}

/** Legacy keys whose values are other labels for the carrier's concept, folded into `aliases`. */
const LEGACY_ALIAS_KEYS = Object.freeze(["defines", "roam_aliases", "roam_alias"]);
/** Legacy keys asserting that another carrier is related, folded into the authorized `see-also` predicate. */
const LEGACY_RELATED_KEYS = Object.freeze(["related", "related-to"]);
/** Legacy keys stating the carrier's creation moment, folded into `date-created`. */
const LEGACY_DATE_CREATED_KEYS = Object.freeze(["date", "created"]);

function list(value) { return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]; }

/**
 * Fold every legacy alias-bearing key into `aliases`, never dropping a label. A `title` beside an
 * explicit name other than the filename stem (which the title→name rename cannot settle) is the
 * same label, and goes, or another label, and becomes an alias.
 */
function foldLegacyAliases(text, stem, actions) {
  let frontmatter = readMarkdownFrontmatter(text).frontmatter ?? {};
  const name = typeof frontmatter.name === "string" ? frontmatter.name : undefined;
  const explicitTitle = typeof frontmatter.title === "string" && name !== undefined && name !== stem;
  if (explicitTitle && frontmatter.title === name) {
    text = deleteKeyOnlyWhenEqual(text, "title", name, actions);
    frontmatter = readMarkdownFrontmatter(text).frontmatter ?? {};
  }
  const keys = LEGACY_ALIAS_KEYS.filter((key) => Object.hasOwn(frontmatter, key));
  if (explicitTitle && Object.hasOwn(frontmatter, "title")) keys.push("title");
  if (keys.length === 0) return text;
  const current = frontmatter.aliases;
  if (current !== undefined && current !== null && typeof current !== "string" && !Array.isArray(current)) throw new TypeError("aliases must be a list to receive folded labels");
  if (keys.some((key) => list(frontmatter[key]).some((label) => typeof label !== "string" && typeof label !== "number"))) throw new TypeError("legacy alias values must be labels");
  const existing = aliasValues(current);
  const aliases = normalizeTermAliases([...existing, ...keys.flatMap((key) => aliasValues(frontmatter[key]))], { name });
  let output = text;
  if (typeof current === "string" || JSON.stringify(aliases) !== JSON.stringify(existing)) output = mutateMarkdownFrontmatter(output, { mode: "set", key: "aliases", value: [...aliases] });
  output = mutateMarkdownFrontmatter(output, { mode: "delete", keys });
  const known = new Set(existing.map((alias) => alias.toLowerCase()));
  for (const key of keys) actions.push(Object.freeze({ operation: "fold-frontmatter-key-into-aliases", key, added: Object.freeze(aliasValues(frontmatter[key]).filter((label) => aliases.some((alias) => alias.toLowerCase() === label.toLowerCase()) && !known.has(label.toLowerCase()))) }));
  return output;
}

/** The carrier identity a legacy related-carrier value names: a Markdown link's target stem, or a label's term stem. */
function relatedIdentity(value) {
  const link = /^\[[^\]]*\]\(([^)#]+)(?:#[^)]*)?\)$/u.exec(String(value).trim());
  const identity = link ? basename(link[1]).replace(/(?:\.org)?\.md$|\.org$/u, "") : termStem(String(value));
  if (!IDENTITY.test(identity)) throw new TypeError(`related value does not name a carrier identity: ${value}`);
  return identity;
}

/** Fold `related`/`related-to` into `see-also`, nested under `relations` when the carrier already keeps one, else at top level. */
function foldLegacyRelated(text, actions) {
  const frontmatter = readMarkdownFrontmatter(text).frontmatter ?? {};
  const keys = LEGACY_RELATED_KEYS.filter((key) => Object.hasOwn(frontmatter, key));
  if (keys.length === 0) return text;
  const nested = frontmatter.relations !== null && typeof frontmatter.relations === "object" && !Array.isArray(frontmatter.relations);
  const prior = list(nested ? frontmatter.relations["see-also"] : frontmatter["see-also"]);
  const folded = keys.flatMap((key) => list(frontmatter[key]).map(relatedIdentity));
  const seeAlso = [...new Set([...prior, ...folded])];
  const value = seeAlso.length === 1 ? seeAlso[0] : seeAlso;
  let output = nested
    ? mutateMarkdownFrontmatter(text, { mode: "set", key: "relations", value: { ...frontmatter.relations, "see-also": value } })
    : mutateMarkdownFrontmatter(text, { mode: "set", key: "see-also", value });
  output = mutateMarkdownFrontmatter(output, { mode: "delete", keys });
  for (const key of keys) actions.push(Object.freeze({ operation: "fold-frontmatter-key-into-relation", key, predicate: "see-also", values: Object.freeze(list(frontmatter[key]).map(relatedIdentity)) }));
  return output;
}

/** Fold an Org `date`/`created` stamp into `date-created` when it is absent or names the same day; a disagreeing stamp stays (still refused). */
function foldLegacyDateCreated(text, actions) {
  let output = text;
  for (const key of LEGACY_DATE_CREATED_KEYS) {
    const frontmatter = readMarkdownFrontmatter(output).frontmatter ?? {};
    if (!Object.hasOwn(frontmatter, key)) continue;
    const stamp = EMBEDDED_ISO_DATE.exec(String(frontmatter[key]))?.[0];
    if (stamp === undefined) continue;
    const stated = frontmatter["date-created"] ?? frontmatter.provenance?.["date-created"];
    const statedDay = stated === undefined ? undefined : EMBEDDED_ISO_DATE.exec(String(stated))?.[0];
    if (stated !== undefined && statedDay !== stamp) continue;
    if (stated === undefined) output = mutateMarkdownFrontmatter(output, { mode: "set", key: "date-created", value: stamp });
    output = mutateMarkdownFrontmatter(output, { mode: "delete", keys: [key] });
    actions.push(Object.freeze({ operation: "fold-frontmatter-date-into-date-created", key, from: frontmatter[key], to: stamp }));
  }
  return output;
}

/** Fold Org-roam `roam-refs` (URLs and `[cite:@key]` citations) into `provenance.sources`. */
function foldRoamRefs(text, actions) {
  const frontmatter = readMarkdownFrontmatter(text).frontmatter ?? {};
  if (!Object.hasOwn(frontmatter, "roam-refs")) return text;
  const provenance = frontmatter.provenance ?? {};
  if (provenance === null || typeof provenance !== "object" || Array.isArray(provenance)) throw new TypeError("provenance must be a map to receive roam-refs");
  const refs = list(frontmatter["roam-refs"]).flatMap((value) => String(value).split(/\s+/u)).map((value) => value.replace(/\\/gu, "").replace(/^['"]|['"]$/gu, "").trim()).filter(Boolean);
  if (refs.length === 0) return text;
  const sources = [...new Set([...list(provenance.sources).map(String), ...refs])];
  let output = mutateMarkdownFrontmatter(text, { mode: "set", key: "provenance", value: { ...provenance, sources } });
  output = mutateMarkdownFrontmatter(output, { mode: "delete", keys: ["roam-refs"] });
  actions.push(Object.freeze({ operation: "fold-frontmatter-key-into-provenance-sources", key: "roam-refs", values: Object.freeze(refs) }));
  return output;
}

/**
 * Fold the Obsidian digital-garden publish flag into the house surface policy's `visibility`:
 * `dg-publish: true` was the author's public opt-in, so it becomes `visibility: public`; `false`
 * already means the default. A flag that disagrees with a stated visibility stays (still refused).
 * A `dg-permalink` that only repeats the identity is redundant and goes.
 */
function foldDigitalGardenFlags(text, stem, actions) {
  const frontmatter = readMarkdownFrontmatter(text).frontmatter ?? {};
  let output = text;
  if (Object.hasOwn(frontmatter, "dg-publish")) {
    const flag = String(frontmatter["dg-publish"]).trim().toLowerCase();
    const visibility = frontmatter.visibility;
    const agrees = flag === "true" ? visibility === undefined || visibility === "public" : flag === "false" || flag === "" || flag === "null" ? visibility !== "public" : false;
    if (agrees) {
      if (flag === "true" && visibility === undefined) output = mutateMarkdownFrontmatter(output, { mode: "set", key: "visibility", value: "public" });
      output = mutateMarkdownFrontmatter(output, { mode: "delete", keys: ["dg-publish"] });
      actions.push(Object.freeze({ operation: "fold-publish-flag-into-visibility", key: "dg-publish", from: frontmatter["dg-publish"], to: flag === "true" ? "public" : visibility ?? "authenticated" }));
    }
  }
  if (frontmatter["dg-permalink"] === stem) output = deleteKeyOnlyWhenEqual(output, "dg-permalink", stem, actions);
  return output;
}

/**
 * Fold the legacy Org-roam and digital-garden keys a term carrier still states into the slots the
 * term schema admits, so no label, link, date, source, or publication choice is lost when the
 * cleanup deletes `defines` and `related`.
 */
function foldLegacyTermKeys(text, stem, actions) {
  let output = foldLegacyAliases(text, stem, actions);
  output = foldLegacyRelated(output, actions);
  output = foldLegacyDateCreated(output, actions);
  output = foldRoamRefs(output, actions);
  return foldDigitalGardenFlags(output, stem, actions);
}

const CITEKEY = /^[a-z][a-z0-9-]*[0-9]{4}[a-z0-9-]*$/u;

function citekeyFromReferenceEntry(entry) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
  const id = entry.id ?? entry.citekey ?? entry.key;
  return typeof id === "string" && CITEKEY.test(id) ? id : null;
}

function authorsFromCslAuthorList(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const names = value
    .map((author) => {
      if (typeof author === "string") return author.trim();
      if (author === null || typeof author !== "object") return "";
      if (typeof author.literal === "string") return author.literal.trim();
      return [author.given, author.family].filter((part) => typeof part === "string" && part.trim() !== "").join(" ").trim();
    })
    .filter((name) => name !== "");
  return names.length === value.length ? names : null;
}

function yearFromCslEntry(entry) {
  if (Number.isInteger(entry.year) && entry.year > 0) return entry.year;
  const issued = entry.issued;
  const fromIssued = Array.isArray(issued) ? issued[0]?.year : issued?.year;
  return Number.isInteger(fromIssued) && fromIssued > 0 ? fromIssued : null;
}

/** Build one term-schema reference object from a CSL-JSON-shaped entry, or null when a required field (authors, title, year) cannot be recovered without inventing it. */
function referenceObjectFromCslEntry(entry) {
  const authors = authorsFromCslAuthorList(entry.author);
  const title = typeof entry.title === "string" && entry.title.trim() !== "" ? entry.title.trim() : null;
  const year = yearFromCslEntry(entry);
  if (authors === null || title === null || year === null) return null;
  const reference = { authors, title, year };
  if (typeof entry["container-title"] === "string" && entry["container-title"].trim() !== "") reference.publication = entry["container-title"].trim();
  if (typeof entry.publisher === "string" && entry.publisher.trim() !== "") reference.publisher = entry.publisher.trim();
  const url = entry.url ?? entry.URL;
  if (typeof url === "string" && url.trim() !== "") reference.url = url.trim();
  const doi = entry.doi ?? entry.DOI;
  if (typeof doi === "string" && doi.trim() !== "") reference.doi = doi.trim();
  if (typeof entry.note === "string" && entry.note.trim() !== "") reference.note = entry.note.trim();
  return reference;
}

/**
 * Convert a references array into the term schema's citekey-keyed map, only when every entry
 * carries a recognizable citekey (`id`/`citekey`/`key`, term-schema citekey pattern) and a
 * complete reference object (authors, title, year) can be built from it without inventing any
 * missing field.
 * @param {unknown} list
 * @returns {{ok: true, map: Record<string, object>}|{ok: false, reason: string}}
 */
export function migrateReferencesListToMap(list) {
  if (!Array.isArray(list) || list.length === 0) return Object.freeze({ ok: false, reason: "empty-or-not-a-list" });
  const map = {};
  for (const entry of list) {
    const citekey = citekeyFromReferenceEntry(entry);
    if (citekey === null) return Object.freeze({ ok: false, reason: "no-recognizable-citekey" });
    if (Object.hasOwn(map, citekey)) return Object.freeze({ ok: false, reason: "duplicate-citekey" });
    const reference = referenceObjectFromCslEntry(entry);
    if (reference === null) return Object.freeze({ ok: false, reason: "incomplete-reference-fields" });
    map[citekey] = reference;
  }
  return Object.freeze({ ok: true, map: Object.freeze(map) });
}

/** Replace a top-level `references:` array value with its migrated citekey map when eligible, recording one action; left unchanged (still refused by the contract) when it is not. */
function migrateReferencesListFrontmatter(text, actions) {
  if (!hasTopLevelKey(text, "references")) return text;
  const current = readMarkdownFrontmatter(text).frontmatter?.references;
  if (!Array.isArray(current)) return text;
  const migration = migrateReferencesListToMap(current);
  if (!migration.ok) return text;
  const output = mutateMarkdownFrontmatter(text, { mode: "set", key: "references", value: migration.map });
  actions.push(Object.freeze({ operation: "migrate-references-list-to-map", key: "references", entries: Object.keys(migration.map).length }));
  return output;
}

const IDENTITY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** Kebab-case identity slug per the ruled transform: lowercase, spaces/underscores to hyphens, non-alphanumerics dropped, hyphens collapsed and trimmed. */
export function kebabCaseIdentitySlug(stem) {
  return stem
    .toLowerCase()
    .replace(/[_\s]+/gu, "-")
    .replace(/[^a-z0-9-]+/gu, "")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function termDirectoryPrefixOf(relativePath) {
  const lastSlash = relativePath.lastIndexOf("/");
  return lastSlash === -1 ? "" : relativePath.slice(0, lastSlash + 1);
}

/** The nearest ancestor `*-services-section` path segment, else the document's own directory, bounding "same section" link-update counting. */
function sectionPrefixOf(relativePath) {
  const segments = relativePath.split("/");
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index].endsWith("-services-section")) return segments.slice(0, index + 1).join("/");
  }
  return termDirectoryPrefixOf(relativePath).replace(/\/$/u, "");
}

/** Whether `text` names `stem` through a Markdown link, an Org file link, or a wikilink — the same shapes `rewriteMigratedTermLinks` rewrites. */
function referencesFilenameStem(text, stem) {
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return [
    new RegExp(`\\]\\([^)#]*?${escaped}(?:\\.(?:md|org))?(?:#[^)]*)?\\)`, "u"),
    new RegExp(`\\[\\[file:[^\\]]*?${escaped}(?:\\.org)?\\]`, "u"),
    new RegExp(`\\[\\[${escaped}(?:\\.md)?\\]\\]`, "u"),
  ].some((pattern) => pattern.test(text));
}

/**
 * Plan (never apply) a rename to a kebab-case identity for every included term-directory
 * document whose filename stem is not already kebab-case, and count the same-section documents
 * that name the old filename and would need a link update when the rename is applied. Renames
 * are never applied by this plan; a version-control lot carries the actual `git mv` and link
 * rewrite.
 * @param {Array<{relativePath: string, text?: string, ignored?: boolean}>} documents
 * @returns {{schema: string, renames: Array<{path: string, currentStem: string, plannedIdentity: string, plannedPath: string, section: string, collision: boolean, linkUpdateCount: number, linkUpdatePaths: string[]}>, counts: {candidates: number, planned: number, collisions: number}}}
 */
export function planIdentityRenames(documents) {
  const bySection = new Map();
  for (const document of documents) {
    if (typeof document.text !== "string") continue;
    const section = sectionPrefixOf(document.relativePath);
    const group = bySection.get(section) ?? [];
    group.push(document);
    bySection.set(section, group);
  }
  const termDocuments = documents.filter((document) => {
    if (typeof document.text !== "string") return false;
    const classification = classifyMarkdownCorpusPath(document.relativePath, { ignored: document.ignored === true });
    return classification.included && classification.termDirectory;
  });
  const existingStemsByDirectory = new Map();
  for (const document of termDocuments) {
    const directory = termDirectoryPrefixOf(document.relativePath);
    const stems = existingStemsByDirectory.get(directory) ?? new Set();
    stems.add(basename(document.relativePath, extname(document.relativePath)));
    existingStemsByDirectory.set(directory, stems);
  }
  const candidates = termDocuments
    .map((document) => {
      const directory = termDirectoryPrefixOf(document.relativePath);
      const stem = basename(document.relativePath, extname(document.relativePath));
      if (IDENTITY.test(stem)) return null;
      return Object.freeze({ document, directory, stem, slug: kebabCaseIdentitySlug(stem) });
    })
    .filter((candidate) => candidate !== null)
    .sort((left, right) => left.document.relativePath.localeCompare(right.document.relativePath, "en"));
  // Two passes: first count how many candidates in each directory target the same slug, so
  // BOTH sides of a collision are flagged, not just the later one processed.
  const targetCounts = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.directory} ${candidate.slug}`;
    targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
  }
  const renames = candidates.map((candidate) => {
    const { document, directory, stem, slug } = candidate;
    const targetKey = `${directory} ${slug}`;
    const collidesWithOtherCandidate = (targetCounts.get(targetKey) ?? 0) > 1;
    const collidesWithExistingFile = slug !== stem && (existingStemsByDirectory.get(directory)?.has(slug) ?? false);
    const collision = slug === "" || collidesWithOtherCandidate || collidesWithExistingFile;
    const section = sectionPrefixOf(document.relativePath);
    const referencingDocuments = (bySection.get(section) ?? []).filter((other) => other.relativePath !== document.relativePath && referencesFilenameStem(other.text, stem));
    return Object.freeze({
      path: document.relativePath,
      currentStem: stem,
      plannedIdentity: slug,
      plannedPath: `${directory}${slug}.md`,
      section,
      collision,
      linkUpdateCount: referencingDocuments.length,
      linkUpdatePaths: Object.freeze(referencingDocuments.map((other) => other.relativePath)),
    });
  });
  const collisions = renames.filter((rename) => rename.collision).length;
  return Object.freeze({
    schema: "computer-glossary-term-identity-rename-plan.v1",
    renames: Object.freeze(renames),
    counts: Object.freeze({ candidates: renames.length, planned: renames.length - collisions, collisions }),
  });
}

function simulateMarkdownCleanup(document) {
  const classification = classifyMarkdownCorpusPath(document.relativePath, { ignored: document.ignored === true });
  if (!classification.included) return Object.freeze({ disposition: "excluded", classification });
  if (typeof document.text !== "string") throw new TypeError(`document text is required: ${document.relativePath}`);
  let output = document.text;
  const actions = [];
  try {
    if (classification.termDirectory) output = foldLegacyTermKeys(output, basename(document.relativePath, extname(document.relativePath)), actions);
    for (const key of ALWAYS_DELETE_KEYS) output = deleteKey(output, key, actions);
    output = deleteKeyOnlyWhenEqual(output, "part-of", "world", actions);
    if (classification.termDirectory) {
      output = deleteKeyOnlyWhenEqual(output, "type", "term", actions);
      const renamed = mutateMarkdownFrontmatter(output, { mode: "rename", from: "title", to: "name", filenameStem: basename(document.relativePath, extname(document.relativePath)) });
      if (renamed !== output) actions.push(Object.freeze({ operation: "rename-frontmatter-key", from: "title", to: "name" }));
      output = renamed;
      output = normalizeDateFrontmatterValues(output, actions);
      output = migrateReferencesListFrontmatter(output, actions);
    }
    const h1 = removeRepeatedOutsideFenceH1(output, frontmatterHandles(output));
    actions.push(...h1.removals);
    output = h1.text;
    if (!h1.preserved) throw new Error("outside-fence H1 removal did not preserve all other bytes");
  } catch (error) {
    return Object.freeze({ disposition: "refused", reason: error.message, reasonClass: /duplicate top-level/u.test(error.message) ? "duplicate-key" : /nested key/u.test(error.message) ? "ambiguous-nested-key" : /already exists/u.test(error.message) ? "title-name-collision" : /invalid document/u.test(error.message) ? "malformed-frontmatter" : "mutation-refusal", attemptedActions: Object.freeze(actions) });
  }
  return Object.freeze({ disposition: output === document.text ? "unchanged" : "planned", output, actions: Object.freeze(actions) });
}

/** Recompute one document's proposed bytes without writing them. */
export function prepareMarkdownCorpusCleanupDocument(document) {
  return simulateMarkdownCleanup(document);
}

/** Plan the founder-routed corpus cleanup without writing any Markdown file. */
export function planMarkdownCorpusCleanup(documents) {
  if (!Array.isArray(documents)) throw new TypeError("documents must be an array");
  const transactions = [], refusals = [], excluded = [], unchangedWitnesses = [];
  for (const document of [...documents].sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"))) {
    const beforeSha256 = sha256Hex(document.text ?? "");
    const simulation = simulateMarkdownCleanup(document);
    if (simulation.disposition === "excluded") {
      excluded.push(Object.freeze({ path: document.relativePath, reason: simulation.classification.reason }));
    } else if (simulation.disposition === "refused") {
      refusals.push(Object.freeze({ path: document.relativePath, beforeSha256, reasonClass: simulation.reasonClass, reason: simulation.reason, attemptedActions: simulation.attemptedActions }));
    } else if (simulation.disposition === "planned") {
      transactions.push(Object.freeze({ path: document.relativePath, beforeSha256, proposedAfterSha256: sha256Hex(simulation.output), actions: simulation.actions, bytePreservation: Object.freeze({ verified: true, method: "composed-byte-preserving-simulation" }) }));
    } else {
      unchangedWitnesses.push(`${document.relativePath}\0${beforeSha256}`);
    }
  }
  const counts = Object.freeze({ input: documents.length, planned: transactions.length, refused: refusals.length, unchanged: unchangedWitnesses.length, excluded: excluded.length });
  return Object.freeze({
    schema: "computer-glossary-markdown-corpus-cleanup-plan.v1",
    counts,
    transactions: Object.freeze(transactions),
    refusals: Object.freeze(refusals),
    excluded: Object.freeze(excluded),
    unchangedWitness: Object.freeze({ count: unchangedWitnesses.length, sha256: sha256Hex(unchangedWitnesses.join("\n")), simulationIdentityVerified: true }),
    invariants: Object.freeze(["dry plan only", "no corpus file written", "ignored, generated, and dependency trees excluded", "unmentioned bytes remain byte-identical"]),
  });
}

/** Re-simulate a plan against the witnessed inputs before any later apply step. */
export function verifyMarkdownCorpusCleanupPlan(plan, documents) {
  if (plan?.schema !== "computer-glossary-markdown-corpus-cleanup-plan.v1") throw new TypeError("cleanup plan is required");
  const observed = planMarkdownCorpusCleanup(documents);
  const errors = [];
  if (JSON.stringify(observed.counts) !== JSON.stringify(plan.counts)) errors.push("count mismatch");
  if (JSON.stringify(observed.transactions) !== JSON.stringify(plan.transactions)) errors.push("transaction mismatch");
  if (JSON.stringify(observed.refusals) !== JSON.stringify(plan.refusals)) errors.push("refusal mismatch");
  if (observed.unchangedWitness.sha256 !== plan.unchangedWitness.sha256) errors.push("unchanged witness mismatch");
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

/**
 * Restrict a cleanup plan to the transactions whose actions are ALL within `kinds` (an
 * `action.operation` allow-list) — a mixed transaction naming any other kind is excluded
 * entirely rather than partially applied. Lets an apply step admit only a named subset of
 * migration kinds (e.g. date normalization and references-map migration) in one pass.
 * @param {ReturnType<typeof planMarkdownCorpusCleanup>} plan
 * @param {string[]} kinds
 * @returns {ReturnType<typeof planMarkdownCorpusCleanup>}
 */
export function selectMarkdownCorpusCleanupTransactionsByActionKinds(plan, kinds) {
  if (plan?.schema !== "computer-glossary-markdown-corpus-cleanup-plan.v1") throw new TypeError("cleanup plan is required");
  if (!Array.isArray(kinds) || kinds.length === 0) throw new TypeError("kinds must be a nonempty array");
  const kindSet = new Set(kinds);
  const selected = plan.transactions.filter((transaction) => transaction.actions.length > 0 && transaction.actions.every((action) => kindSet.has(action.operation)));
  return Object.freeze({ ...plan, transactions: Object.freeze(selected), counts: Object.freeze({ ...plan.counts, planned: selected.length }) });
}
