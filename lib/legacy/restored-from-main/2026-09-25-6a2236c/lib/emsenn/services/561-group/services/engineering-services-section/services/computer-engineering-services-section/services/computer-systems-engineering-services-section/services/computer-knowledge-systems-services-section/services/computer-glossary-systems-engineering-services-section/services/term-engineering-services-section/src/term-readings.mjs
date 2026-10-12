import { posix } from "node:path";
import { extent, intent, makeContext } from "@lenticule-science/metrologic/closure/formal-context";

/**
 * Term readings: one name as the documents that answer to it, each read in the locale (the
 * owning section, the register it is written in) where it is filed, with the claims it makes.
 * A reading's claims are its frontmatter relations and keywords and the names of the documents
 * it links; its generated concept is the closure of those claims in a context of readings
 * (metrologic's formal context), as `TermContext.generatedConcept` in Obsmetrologia's
 * `Site/Intension.lean`.
 *
 * Two readings of one name are:
 * - `copies` -- their texts overlap (one thing filed twice: merge);
 * - `same-concept` -- their claims close to one concept though the texts differ (merge, or
 *   keep one as the other's alias);
 * - `related` -- they share some text or claims: a transport is owed (link them, say how
 *   they differ);
 * - `unconnected` -- they share nothing. Sharing nothing is not evidence of two senses: it is
 *   the absence of any evidence either way, the state condensing exists to end. A reader
 *   decides whether this is one sense written twice (merge or link) or one word lawfully read in
 *   two registers (polysemy: keep both, each saying its register) -- or, in one locale, two
 *   senses competing in one register (rename one).
 */

/** Frontmatter keys that describe the carrier, not what the term claims. */
const CARRIER_KEYS = new Set(["title", "name", "id", "identity", "aliases", "alias", "description", "summary",
  "date", "date-created", "date-modified", "date-updated", "status", "authors", "author", "provenance", "source",
  "path", "license", "visibility", "draft", "weight", "slug", "lang", "language"]);

/**
 * The locale a document is filed in: the section that holds it, read down the section chain
 * (`a-section/services/b-section/services/...`) to the first segment that is neither a section
 * nor `services`. A document no section holds is filed in its directory.
 */
export function localeOf(path) {
  const segments = path.split("/");
  let owner = -1;
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (/-section$/u.test(segments[index])) owner = index;
    else if (segments[index] !== "services" && owner >= 0) break;
  }
  return owner < 0 ? posix.dirname(path) : segments.slice(0, owner + 1).join("/");
}

/** The short name of a locale: its section directory without the `-services-section` suffix. */
export function localeName(locale) {
  return posix.basename(locale).replace(/-(?:services-)?section$/u, "");
}

function slug(value) {
  return String(value).trim().toLowerCase().replace(/\.(?:md|markdown)$/u, "").replace(/^.*\//u, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/gu, "");
}

function values(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(values);
  if (typeof value === "object") return Object.entries(value).flatMap(([key, inner]) => values(inner).map((item) => `${slug(key)}/${item}`));
  const text = slug(value);
  return text ? [text] : [];
}

/**
 * The claims a document makes: `key:value` for each frontmatter relation or keyword value (link
 * targets and paths read as the name they end in), and `links:name` for each document it links.
 */
export function claimProfile({ frontmatter = {}, links = [] } = {}) {
  const claims = new Set();
  for (const [key, value] of Object.entries(frontmatter ?? {})) {
    if (CARRIER_KEYS.has(key)) continue;
    const predicate = key === "tags" ? "keywords" : key;
    for (const item of values(value)) claims.add(`${predicate}:${item}`);
  }
  for (const target of links) {
    const name = slug(target);
    if (name) claims.add(`links:${name}`);
  }
  return claims;
}

function jaccard(left, right) {
  if (left.size === 0 && right.size === 0) return 0;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * Compare the readings of one name.
 * @param {{name: string, readings: Array<{path: string, title?: string, frontmatter?: object, links?: string[]}>, overlap?: (left: string, right: string) => number|null}} input
 *   `overlap` estimates the text overlap of two documents (MinHash; null when either is too short).
 */
export function compareTermReadings({ name, readings, overlap = () => null } = {}) {
  if (!Array.isArray(readings)) throw new TypeError("readings must be an array");
  const read = readings.map((reading) => ({ ...reading, locale: localeOf(reading.path), claims: claimProfile(reading) }));
  const pairs = [];
  for (let i = 0; i < read.length; i += 1) for (let j = i + 1; j < read.length; j += 1) {
    const left = read[i], right = read[j];
    const text = overlap(left.path, right.path);
    const claims = jaccard(left.claims, right.claims);
    const sameLocale = left.locale === right.locale;
    const verdict = text !== null && text >= 0.5 ? "copies"
      : claims >= 0.6 && left.claims.size >= 3 && right.claims.size >= 3 ? "same-concept"
      : (text === null || text < 0.15) && claims < 0.1 ? "unconnected"
      : "related";
    pairs.push(Object.freeze({ left: left.path, right: right.path, sameLocale, textOverlap: text, claimOverlap: Number(claims.toFixed(3)), verdict,
      shared: Object.freeze([...left.claims].filter((claim) => right.claims.has(claim)).sort()) }));
  }
  return Object.freeze({
    type: "TermReadings", name,
    readings: Object.freeze(read.map(({ path, title, locale, claims }) => Object.freeze({ path, title: title ?? null, locale, register: localeName(locale), claims: claims.size }))),
    pairs: Object.freeze(pairs),
  });
}

/**
 * The generated concepts of a locale's terms: in the formal context whose objects are the terms
 * and whose attributes are their claims, each term's concept is (extent, intent) of its claim
 * profile. Terms generating one concept are indistinguishable by anything they claim -- aliases
 * in one register, or terms too thinly stated to tell apart. A term whose extent holds another
 * is broader than it: the other claims everything it does.
 * @param {{terms: Array<{path: string, title?: string, frontmatter?: object, links?: string[]}>, minimumClaims?: number}} input
 */
export function generatedTermConcepts({ terms, minimumClaims = 2 } = {}) {
  if (!Array.isArray(terms)) throw new TypeError("terms must be an array");
  const profiled = terms.map((term) => ({ ...term, claims: claimProfile(term) })).filter((term) => term.claims.size >= minimumClaims);
  const attributes = [...new Set(profiled.flatMap((term) => [...term.claims]))].sort();
  const context = makeContext(profiled.map((term) => term.path), attributes, profiled.flatMap((term) => [...term.claims].map((claim) => [term.path, claim])));
  const byExtent = new Map();
  const broader = [];
  for (const term of profiled) {
    const objects = extent(context, term.claims);
    const key = [...objects].sort().join("\u0000");
    const group = byExtent.get(key) ?? { extent: [...objects].sort(), intent: [...intent(context, objects)].sort(), generatedBy: [] };
    group.generatedBy.push(term.path);
    byExtent.set(key, group);
    const narrower = [...objects].filter((path) => path !== term.path);
    if (narrower.length > 0) broader.push(Object.freeze({ term: term.path, narrower: Object.freeze(narrower.sort()) }));
  }
  const aliases = [...byExtent.values()].filter((group) => group.generatedBy.length > 1)
    .map((group) => Object.freeze({ terms: Object.freeze(group.generatedBy.sort()), intent: Object.freeze(group.intent) }));
  return Object.freeze({ type: "GeneratedTermConcepts", terms: profiled.length, attributes: attributes.length,
    aliases: Object.freeze(aliases), broader: Object.freeze(broader) });
}
