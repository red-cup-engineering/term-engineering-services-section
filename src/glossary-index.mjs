import { RELATION_PREDICATE_RANGES, recognizeTermMarkdown } from "./term-carrier.mjs";
import { glossaryConceptId, glossarySignToken } from "./glossary-token.mjs";
import { confinePath } from "@red-cup-engineering/computer-filepath-engineering-services-section/filepath";
import { walkPosixPathsSync } from "@red-cup-engineering/computer-filepath-engineering-services-section/walk-posix-paths";
const EXCLUDED_DIRECTORY_NAMES = ["legacy", "triage", "node_modules", "dist", "test", "fixtures"];
/** The directories a section's glossary files its carriers under. Each is one term carrier whatever its facet. */
export const GLOSSARY_FACETS = Object.freeze({ terms: "term", concepts: "concept", topics: "topic" });
const FACET_DIRECTORY_PATTERN = /(?:^|\/)content\/text\/glossary\/(terms|concepts|topics)\//u;
const CARRIER_SUFFIX_PATTERN = /(^|\/)content\/text\/glossary\/(?:terms|concepts|topics)\/[^/]+$/u;

/**
 * Every glossary carrier (term, concept or topic) Markdown file under `root`, excluding any path
 * passing through a legacy, triage, node_modules, dist, test, or fixtures directory (test fixtures
 * are not corpus).
 * @param {string} root
 * @returns {string[]} absolute paths, sorted
 */
export function findGlossaryTermMarkdownPaths(root) {
  const walk = walkPosixPathsSync({ root, extensions: [".md"], excludes: EXCLUDED_DIRECTORY_NAMES });
  const found = walk.files
    .filter(({ kind, path }) => kind === "file" && CARRIER_SUFFIX_PATTERN.test(path))
    .map(({ path }) => `${walk.root}/${path}`);
  return found.sort();
}

/**
 * The science subsection owning a term path: the first `services/<name>` segment beneath
 * `root`, or `"science-root"` for a term carried directly under the root section (matches the
 * subsection naming already used by the science-carrier-provenance census in this data/records/).
 * @param {string} root
 * @param {string} absolutePath
 * @returns {string}
 */
export function subsectionOf(root, absolutePath) {
  const parts = confinePath({ root, path: absolutePath }).relativePath.split("/");
  return parts[0] === "services" && parts[1] ? parts[1] : "science-root";
}

/**
 * The section owning a glossary carrier path: the root-relative directory that carries
 * `content/text/glossary/{terms,concepts,topics}/`, which is the carrier's concept scheme. Unlike
 * `subsectionOf`, this keeps every nested section distinct, so one index over the whole 561 Group
 * still tells each section's glossary apart. A section's terms, concepts and topics share one scheme.
 * @param {string} path root-relative carrier path
 * @returns {string} the owning section directory, or `""` when the glossary sits at the root
 */
export function schemeOf(path) {
  const match = FACET_DIRECTORY_PATTERN.exec(path);
  if (!match) throw new TypeError(`not a glossary carrier path: ${path}`);
  return path.slice(0, match.index);
}

/**
 * The facet a glossary carrier path is filed under: `"term"`, `"concept"` or `"topic"`.
 * @param {string} path root-relative carrier path
 * @returns {"term"|"concept"|"topic"}
 */
export function facetOf(path) {
  const match = FACET_DIRECTORY_PATTERN.exec(path);
  if (!match) throw new TypeError(`not a glossary carrier path: ${path}`);
  return GLOSSARY_FACETS[match[1]];
}

/** Carrier identity syntax, matching the term record schema's own rule. */
const IDENTITY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
/** v2: carriers of every facet, each record naming its `facet` and its concept `token`. */
const SCHEMA = "computer-glossary-index.v2";
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;
const SEARCH_WEIGHTS = Object.freeze({ nameExact: 100, name: 40, alias: 25, keyword: 15, description: 5 });
/** Record fields carried from a recognized term into a glossary index record, in their carried order. */
const RECORD_FIELDS = Object.freeze(["identity", "name", "description", "consent-status", "visibility", "type", "aliases", "keywords", "relations", "references", "provenance", "body"]);

function tokenize(text) {
  return typeof text === "string" ? text.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean) : [];
}

function nonEmpty(value) {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object" && value !== null) return Object.keys(value).length > 0;
  return true;
}

/**
 * One glossary index record: the recognized term's carried fields plus the path it was read
 * from, the subsection that owns it, its concept scheme (the owning section directory), the facet
 * it is filed under, and its concept token (the semiotic content address of `{scheme, identity}`,
 * see `glossary-token.mjs`). Generic over any glossary carrier; nothing medical, nor any other
 * domain, is named here.
 * @param {ReturnType<typeof recognizeTermMarkdown>} recognized
 * @param {string} path
 * @param {string} section
 * @returns {Readonly<object>}
 */
function projectRecord(recognized, path, section) {
  const record = {};
  for (const field of RECORD_FIELDS) if (nonEmpty(recognized[field]) || field === "identity" || field === "name" || field === "body") record[field] = recognized[field];
  record.path = path;
  record.section = section;
  record.scheme = schemeOf(path);
  record.facet = facetOf(path);
  record.token = glossaryConceptId(record.scheme, record.identity);
  return Object.freeze(record);
}

/**
 * Resolve a carrier-range assertion's target identity from the asserting record's point of view:
 * the indexed record whose scheme is nearest in the section tree (fewest steps up then down, so
 * the asserting scheme itself first). Two equally near candidates leave the assertion unresolved,
 * and a resolver never guesses between them. Records of one identity in one scheme (a term and a
 * topic, say) are one concept with one token, so they are one candidate, the first indexed.
 * @param {readonly {identity: string, scheme: string}[]} records
 * @returns {(from: {scheme: string}, identity: string) => object|undefined}
 */
export function createNearestSchemeResolver(records) {
  const byIdentity = new Map();
  for (const record of records) {
    const candidates = byIdentity.get(record.identity) ?? [];
    if (!candidates.some((candidate) => candidate.scheme === record.scheme)) byIdentity.set(record.identity, [...candidates, record]);
  }
  return function resolve(from, identity) {
    const distance = (scheme) => {
      const left = from.scheme.split("/"), right = scheme.split("/");
      let shared = 0; while (shared < left.length && shared < right.length && left[shared] === right[shared]) shared += 1;
      return (left.length - shared) + (right.length - shared);
    };
    const ranked = (byIdentity.get(identity) ?? []).map((candidate) => ({ candidate, distance: distance(candidate.scheme) })).sort((left, right) => left.distance - right.distance);
    return ranked.length === 1 || (ranked.length > 1 && ranked[0].distance < ranked[1].distance) ? ranked[0].candidate : undefined;
  };
}

/**
 * Project a deterministic glossary index from a set of already-read Markdown documents. Pure:
 * no filesystem access, so it runs equally in a Node script or a fetch-handler (edge) isolate.
 * Re-derivation from the same documents is byte-identical (no timestamps, records sorted by
 * identity then path).
 * @param {{root: string, documents: Array<{path: string, filename: string, text: string}>}} input
 *   `documents[].path` is relative to `root`.
 * @returns {Readonly<{schema: string, root: string, records: readonly object[], refused: readonly object[]}>}
 */
export function projectGlossaryIndex({ root, documents } = {}) {
  if (typeof root !== "string" || root.trim() === "") throw new TypeError("root must be a nonempty string");
  if (!Array.isArray(documents)) throw new TypeError("documents must be an array");
  const records = [];
  const refused = [];
  for (const { path, filename, text } of documents) {
    const recognized = recognizeTermMarkdown({ text, filename });
    if (!recognized.admitted) { refused.push(Object.freeze({ path, findings: recognized.findings })); continue; }
    records.push(projectRecord(recognized, path, subsectionOf(root, path)));
  }
  records.sort((left, right) => left.identity.localeCompare(right.identity) || left.path.localeCompare(right.path));
  return Object.freeze({ schema: SCHEMA, root, records: Object.freeze(records), refused: Object.freeze(refused) });
}

function carrierRelationEntries(record) {
  return Object.entries(record.relations ?? {}).filter(([predicate]) => RELATION_PREDICATE_RANGES[predicate] === "carrier");
}

function scoreRecord(record, queryTokens, wholeQuery) {
  const nameTokens = tokenize(record.name);
  let score = 0;
  if (wholeQuery !== "" && nameTokens.join(" ") === wholeQuery) score += SEARCH_WEIGHTS.nameExact;
  const aliasTokens = (record.aliases ?? []).flatMap(tokenize);
  const keywordTokens = record.keywords ?? [];
  const descriptionTokens = tokenize(record.description);
  for (const token of queryTokens) {
    if (nameTokens.includes(token)) score += SEARCH_WEIGHTS.name;
    if (aliasTokens.includes(token)) score += SEARCH_WEIGHTS.alias;
    if (keywordTokens.includes(token)) score += SEARCH_WEIGHTS.keyword;
    if (descriptionTokens.includes(token)) score += SEARCH_WEIGHTS.description;
  }
  return score;
}

function resolveSearchLimit(limit) {
  if (limit === undefined) return DEFAULT_SEARCH_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError("limit must be a positive integer");
  return Math.min(limit, MAX_SEARCH_LIMIT);
}

/** A typed SignCell concept token, distinct from the lexical sign it uses. */
const TOKEN_ID = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;
const SCHEME = /^(?:[a-z0-9][a-z0-9-]*)(?:\/[a-z0-9][a-z0-9-]*)*$/u;

/**
 * Normalize a concept question. An unqualified string is a sign (a word) or
 * an exact source-generated SignCell concept token, NEVER a guessed concept.
 * Same-sign/different-scheme polysemy and same-concept/multiple definitions
 * are actual readings of language space, not map-key collisions.
 */
function glossarySelector(selector) {
  if (typeof selector === "string") {
    if (IDENTITY.test(selector)) return Object.freeze({ identity: selector });
    if (TOKEN_ID.test(selector)) return Object.freeze({ token: selector });
    throw new TypeError("glossary selector requires a sign identity or exact SignCell concept token");
  }
  if (!selector || typeof selector !== "object" || Array.isArray(selector) ||
      Object.keys(selector).some(key => !["token", "identity", "scheme", "facet"].includes(key)) ||
      (selector.token === undefined) === (selector.identity === undefined) ||
      (selector.token !== undefined && (!TOKEN_ID.test(selector.token) || selector.scheme !== undefined)) ||
      (selector.identity !== undefined && !IDENTITY.test(selector.identity)) ||
      (selector.scheme !== undefined && (typeof selector.scheme !== "string" ||
        (selector.scheme !== "" && !SCHEME.test(selector.scheme)))) ||
      (selector.facet !== undefined && !Object.values(GLOSSARY_FACETS).includes(selector.facet)))
    throw new TypeError("glossary selector needs one token OR identity, with optional owning scheme/facet");
  return Object.freeze({ ...selector });
}

/**
 * Bind the original glossary index, preserving typed SignCell concept IDs,
 * scheme-scoped senses and definition facets. This is a pure reading of an
 * ALREADY ADMITTED index, not an actor grant or a public-surface permission.
 * Bind authorized index suppliers upstream; use the same nearest-scheme
 * resolver as the native SKOS and SignGraph foam projectors.
 *
 * A sign can have many readings. readings(selector) gives all of them;
 * resolve(selector) gives one only when uniquely determined, otherwise
 * refuses. Do not overwrite senses under an opaque last-wins word key.
 */
export function createGlossaryIndexReader(index) {
  if (!index || typeof index !== "object" || !Array.isArray(index.records))
    throw new TypeError("index must be a projected glossary index");
  const byIdentity = new Map(), byToken = new Map();
  for (const record of index.records) {
    if (!IDENTITY.test(record.identity) || !TOKEN_ID.test(record.token) ||
        typeof record.scheme !== "string" ||
        record.token !== glossaryConceptId(record.scheme, record.identity))
      throw new TypeError("glossary reading requires native scheme-qualified SignCell concept tokens");
    byIdentity.set(record.identity, [...(byIdentity.get(record.identity) ?? []), record]);
    byToken.set(record.token, [...(byToken.get(record.token) ?? []), record]);
  }
  const nearest = createNearestSchemeResolver(index.records);

  /** Recover all original definition readings, never quietly choosing a scheme or facet. */
  function readings(selector) {
    const question = glossarySelector(selector);
    const group = question.token === undefined
      ? byIdentity.get(question.identity) ?? [] : byToken.get(question.token) ?? [];
    return Object.freeze(group.filter(record =>
      (question.scheme === undefined || record.scheme === question.scheme) &&
      (question.facet === undefined || record.facet === question.facet)));
  }

  /** One sense and definition, only when actually disambiguated by its selector. */
  function resolve(selector) {
    const found = readings(selector);
    if (found.length > 1)
      throw new TypeError("ambiguous glossary sign/concept: choose the owning scheme, concept token and, if needed, definition facet; use readings for all senses");
    return found[0];
  }

  /**
   * Native neighborhood: carrier assertions resolve relative to their actual
   * source scheme. Incoming means 'resolves to THIS concept token', not
   * merely 'spells the same lexical sign in another section'.
   * An unresolved target retains its SignCell sign token and its source
   * record; it never becomes a claimed concept or a negative fact.
   */
  function neighborhood(selector) {
    const record = resolve(selector);
    const outgoing = [], incoming = [];
    if (!record) return Object.freeze({
      record: undefined, outgoing: Object.freeze([]), incoming: Object.freeze([]),
    });
    for (const [predicate, assertion] of carrierRelationEntries(record)) {
      for (const target of Array.isArray(assertion) ? assertion : [assertion]) {
        const targetRecord = nearest(record, target);
        outgoing.push(Object.freeze({
          predicate, target,
          targetSign: glossarySignToken(target).id,
          ...(targetRecord ? { targetToken: targetRecord.token, record: targetRecord } : { unresolved: true }),
        }));
      }
    }
    for (const candidate of index.records) {
      for (const [predicate, assertion] of carrierRelationEntries(candidate)) {
        for (const target of Array.isArray(assertion) ? assertion : [assertion]) {
          if (nearest(candidate, target)?.token === record.token) {
            incoming.push(Object.freeze({
              predicate, from: candidate.identity, fromToken: candidate.token,
              fromFacet: candidate.facet, record: candidate,
            }));
          }
        }
      }
    }
    return Object.freeze({ record, outgoing: Object.freeze(outgoing), incoming: Object.freeze(incoming) });
  }

  /**
   * Human lexical search with machine-readable identity for each hit.
   * A hit is a source reading of a scheme and facet, not an assertion
   * of truth or an equivalence between same-spelled concepts.
   */
  function search(query, { limit } = {}) {
    if (typeof query !== "string" || query.trim() === "") throw new TypeError("query must be nonempty text");
    const effectiveLimit = resolveSearchLimit(limit);
    const wholeQuery = query.trim().toLowerCase();
    const queryTokens = tokenize(query);
    const results = [];
    for (const record of index.records) {
      const score = queryTokens.length === 0 ? 0 : scoreRecord(record, queryTokens, wholeQuery);
      if (score > 0) results.push(Object.freeze({
        identity: record.identity,
        sign: glossarySignToken(record.identity).id,
        token: record.token,
        scheme: record.scheme, facet: record.facet,
        name: record.name, description: record.description, section: record.section, score,
      }));
    }
    results.sort((left, right) => right.score - left.score ||
      left.token.localeCompare(right.token) || left.facet.localeCompare(right.facet));
    return Object.freeze(results.slice(0, effectiveLimit));
  }

  return Object.freeze({ readings, resolve, neighborhood, search });
}
