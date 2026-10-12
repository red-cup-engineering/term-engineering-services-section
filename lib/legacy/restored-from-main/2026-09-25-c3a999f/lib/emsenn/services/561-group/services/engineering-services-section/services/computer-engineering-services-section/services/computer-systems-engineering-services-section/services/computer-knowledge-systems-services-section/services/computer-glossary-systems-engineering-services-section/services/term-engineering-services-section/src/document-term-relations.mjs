import { AUTHORIZED_RELATION_PREDICATES, relationPredicateRange } from "./term-carrier.mjs";

/**
 * Frontmatter -> declared-relation-assertion projection for one admitted Markdown document.
 *
 * This is the document->rows half of a declared-relation ledger: given one document's path and
 * frontmatter, which term-naming assertions does it make? Witnessing (content-addressed row
 * identity, EAVT materialization against carrier bytes) stays with whichever ledger reader calls
 * this once per carrier read -- this module never opens a file or knows about a vault root.
 *
 * The founder's directive this exists to satisfy: frontmatter keys and keywords ARE terms and
 * form the DAG, for every admitted document, not only glossary term carriers. A keyword or
 * relation value that names no defined term is a corpus gap to report (`unresolvedTermGaps`),
 * never a silently dropped assertion.
 */

const CONCEPT = /^[a-z][a-z0-9_/-]{0,80}$/u;

/** Fold free text into the lowercase, hyphenated shape a declared term identity must take, or null when it cannot. */
export function foldTermIdentity(value) {
  if (typeof value !== "string") return null;
  const folded = value.trim().replace(/^['"]|['"]$/gu, "").toLowerCase().replace(/\s+/gu, "-");
  return CONCEPT.test(folded) ? folded : null;
}

/** `foldTermIdentity` over one value or a (possibly nested) array of them, dropping what does not fold. */
export function foldTermIdentities(value) {
  if (Array.isArray(value)) return value.flat(Infinity).map(foldTermIdentity).filter(Boolean);
  const single = foldTermIdentity(value);
  return single ? [single] : [];
}

function relationValues(relation, value) {
  if (relationPredicateRange(relation) !== "literal") return foldTermIdentities(value);
  const values = Array.isArray(value) ? value.flat(Infinity) : [value];
  return values.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
}

/**
 * One document's declared relation-predicate assertions: `{path, relation, concept, polarity}[]`,
 * plus a count of declared values that named no concept at all (not even an unresolved one --
 * e.g. a number, an empty string, or `null`).
 */
export function declaredRelationsOf({ path, frontmatter, relationKeys = [] } = {}) {
  if (typeof path !== "string" || path === "") throw new TypeError("path is required");
  const assertions = [];
  let unnamed = 0;
  for (const relation of relationKeys) {
    const declared = frontmatter?.[relation];
    if (declared === undefined || declared === null) continue;
    const named = relationValues(relation, declared);
    const total = Array.isArray(declared) ? declared.flat(Infinity).length : 1;
    unnamed += total - named.length;
    for (const concept of named) assertions.push(Object.freeze({ path, relation, concept, polarity: "positive" }));
  }
  return Object.freeze({ assertions: Object.freeze(assertions), unnamed });
}

function keywordEntries(value) {
  if (Array.isArray(value)) return value.flat(Infinity);
  if (typeof value === "string") return value.split(",");
  return [];
}

/** Every distinct term identity a document's frontmatter `keywords` names -- a list or a comma-separated string, either way. */
export function declaredKeywordsOf(frontmatter) {
  return Object.freeze([...new Set(foldTermIdentities(keywordEntries(frontmatter?.keywords)))]);
}

/** A document's frontmatter `title`, trimmed, or null. Kept as literal text -- search matches its words; it is never folded to a term identity. */
export function declaredTitleOf(frontmatter) {
  const title = frontmatter?.title;
  if (typeof title !== "string") return null;
  const trimmed = title.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Project one document's frontmatter into declared-relation assertions: one `declares-keyword`
 * assertion per keyword (whether or not any carrier defines it -- that is a corpus-wide fact, see
 * `unresolvedTermGaps`), one `titled` assertion for its title when it has one, and the document's
 * authorized relation-predicate assertions (`declaredRelationsOf`).
 *
 * `relationKeys` defaults to the full authorized vocabulary, matching what an ordinary (non-term)
 * document is scanned for; a caller admitting a glossary term carrier instead passes that term's
 * own normalized `relations` keys.
 */
export function projectDocumentTermRows({ path, frontmatter, relationKeys = AUTHORIZED_RELATION_PREDICATES } = {}) {
  if (typeof path !== "string" || path === "") throw new TypeError("path is required");
  const named = [];
  for (const keyword of declaredKeywordsOf(frontmatter)) named.push(Object.freeze({ path, relation: "declares-keyword", concept: keyword, polarity: "positive" }));
  const title = declaredTitleOf(frontmatter);
  if (title !== null) named.push(Object.freeze({ path, relation: "titled", concept: title, polarity: "positive" }));
  const declared = declaredRelationsOf({ path, frontmatter, relationKeys });
  return Object.freeze({ assertions: Object.freeze([...named, ...declared.assertions]), unnamed: declared.unnamed });
}

/**
 * The corpus gap: one `{path, relation, term}` per `declares-keyword` or carrier-range relation
 * assertion whose value no admitted carrier defines. `knownTerms` is every value a `defines`
 * assertion names anywhere in the ledger being built -- a corpus-wide fact the caller assembles
 * (this module has no notion of "the whole ledger"), not a scope-local one: a keyword-web edge's
 * own current/ancestor-scope resolution is a separate, narrower question this function does not
 * re-litigate.
 */
export function unresolvedTermGaps(assertions, knownTerms) {
  const known = knownTerms instanceof Set ? knownTerms : new Set(knownTerms);
  return Object.freeze(
    assertions
      .filter(({ relation }) => relation === "declares-keyword" || relationPredicateRange(relation) === "carrier")
      .filter(({ concept }) => !known.has(concept))
      .map(({ path, relation, concept }) => Object.freeze({ path, relation, term: concept })),
  );
}
