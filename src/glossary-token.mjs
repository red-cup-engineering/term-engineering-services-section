import { defineSchemaType } from "@red-cup-engineering/computer-data-engineering-services-section/type-system/schema-type";
import { createTypedMark, typedMarkIdentity } from "@red-cup-engineering/signcell/typed-mark";

/**
 * Glossary tokens: every glossary carrier, whatever its facet, as SignCell typed marks whose
 * identity is their semiotic content address (`ni:///sha-256;…`). Four kinds of token, so a sign,
 * what a section means by it, what was written about it, and where it is filed stay distinct:
 *
 * - a **sign** is the bare carrier identity (`team`); every section that files the word shares it;
 * - a **concept** is one scheme's meaning of a sign (`{ scheme, identity }`), stable while its
 *   definition is revised, so relations aimed at it do not move when its text changes;
 * - a **definition** is one admitted carrier's content, and changes whenever the carrier does;
 * - a **scheme** is the section whose glossary files the concept.
 */

/** The scheme path of a glossary carried directly at the indexed root. */
export const ROOT_SCHEME_PATH = "561-group";
/** Carrier identity syntax, matching the term record schema's own rule. */
const IDENTITY = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
/** The facets a glossary files its carriers under, singular as a definition states them. */
export const GLOSSARY_FACET_NAMES = Object.freeze(["term", "concept", "topic"]);

/**
 * The IRI path of a concept scheme, from its section path alone (the `services/` connectors
 * dropped), so a concept's IRI and token never depend on which other sections were indexed with it.
 * @param {string} scheme root-relative section directory, `""` for the root
 * @returns {string}
 */
export function schemeIriPath(scheme) {
  if (scheme === "") return ROOT_SCHEME_PATH;
  return scheme.split("/").filter((segment) => segment !== "services" && segment !== "").join("/");
}

export const glossarySignType = defineSchemaType({
  $id: "https://schemas.561.group/knowledge/glossary-sign.schema.json",
  title: "Glossary sign",
  description: "A glossary carrier identity as a sign, shared by every section that files the same word.",
  type: "object", required: ["identity"], additionalProperties: false,
  properties: { identity: { type: "string", pattern: IDENTITY } },
});
export const glossaryConceptType = defineSchemaType({
  $id: "https://schemas.561.group/knowledge/glossary-concept.schema.json",
  title: "Glossary concept",
  description: "One concept scheme's meaning of a sign, addressed by scheme and identity so it outlives revisions of its definition.",
  type: "object", required: ["scheme", "identity"], additionalProperties: false,
  properties: { scheme: { type: "string", minLength: 1 }, identity: { type: "string", pattern: IDENTITY } },
});
export const glossarySchemeType = defineSchemaType({
  $id: "https://schemas.561.group/knowledge/glossary-scheme.schema.json",
  title: "Glossary scheme",
  description: "The section whose glossary files a concept, by its scheme IRI path.",
  type: "object", required: ["scheme"], additionalProperties: false,
  properties: { scheme: { type: "string", minLength: 1 } },
});
export const glossaryDefinitionType = defineSchemaType({
  $id: "https://schemas.561.group/knowledge/glossary-definition.schema.json",
  title: "Glossary definition",
  description: "One admitted glossary carrier's content: the concept it defines, its facet, and its record without its file location.",
  type: "object", required: ["concept", "facet", "record"], additionalProperties: false,
  properties: {
    concept: { type: "string", pattern: "^ni:///sha-256;[A-Za-z0-9_-]{43}$" },
    facet: { enum: [...GLOSSARY_FACET_NAMES] },
    record: { type: "object", required: ["identity", "name", "body"] },
  },
});

function minted(result, label) {
  if (!result.ok) throw new TypeError(`${label} token refused: ${result.refusal.message}`);
  return result.value;
}
/** The concept token id for a scheme path (root-relative section directory) and identity, without minting the mark. */
export const glossaryConceptId = (scheme, identity) => typedMarkIdentity(glossaryConceptType.id, Object.freeze({ scheme: schemeIriPath(scheme), identity }));
/** @param {string} identity */
export const glossarySignToken = (identity) => minted(createTypedMark(glossarySignType, { identity }), "sign");
/** @param {string} scheme root-relative section directory @param {string} identity */
export const glossaryConceptToken = (scheme, identity) => minted(createTypedMark(glossaryConceptType, { scheme: schemeIriPath(scheme), identity }), "concept");
/** @param {string} scheme root-relative section directory */
export const glossarySchemeToken = (scheme) => minted(createTypedMark(glossarySchemeType, { scheme: schemeIriPath(scheme) }), "scheme");

/** Index record fields that say where a carrier was read from, not what it says; a definition omits them, so moving a file does not change its address. */
const LOCATION_FIELDS = new Set(["path", "section", "scheme", "token", "facet"]);
/**
 * The definition token of one glossary index record: what the carrier says, bound to the concept it defines.
 * @param {{scheme: string, identity: string, facet?: string}} record a `computer-glossary-index` record
 */
export function glossaryDefinitionToken(record) {
  const content = Object.fromEntries(Object.entries(record).filter(([key]) => !LOCATION_FIELDS.has(key)));
  return minted(createTypedMark(glossaryDefinitionType, { concept: glossaryConceptId(record.scheme, record.identity), facet: record.facet ?? "term", record: content }), "definition");
}
