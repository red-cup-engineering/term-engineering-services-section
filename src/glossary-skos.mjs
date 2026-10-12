import { SCHEMA_ORG_CONTEXT, SKOS_NAMESPACE, definedTermJsonLd, definedTermSetJsonLd } from "@red-cup-engineering/computer-triplet-serialized-content-engineering-services-section/schema-org";
import { RELATION_PREDICATE_RANGES } from "./term-carrier.mjs";
import { createNearestSchemeResolver } from "./glossary-index.mjs";
import { ROOT_SCHEME_PATH, schemeIriPath } from "./glossary-token.mjs";

const SCHEMA = "computer-glossary-skos.v3";
/** Where the 561 Group names its knowledge; concept IRIs are `<base><scheme path>/<identity>`. */
export const DEFAULT_KNOWLEDGE_BASE = "https://561.group/knowledge/";
/** House relation predicates, as IRIs in the same `/ns/predicate/<name>` shape GEODE serves. */
export const TERM_VOCABULARY = "https://561.group/ns/predicate/";
/** Who a projection is for, under the house surface policy: the public sees only terms whose own carrier says `visibility: public`. */
export const GLOSSARY_AUDIENCES = Object.freeze(["public", "authenticated"]);
/** Carrier predicates whose object is the subject's genus or whole (SKOS hierarchical, upward). */
const BROADER = new Set(["subtype-of", "instance-of", "part-of", "component-of"]);
/** Carrier predicates whose object is the subject's species or part (SKOS hierarchical, downward). */
const NARROWER = new Set(["types", "components", "composed-of", "contains", "includes"]);

const CONTEXT = Object.freeze([SCHEMA_ORG_CONTEXT, Object.freeze({ skos: SKOS_NAMESPACE, dct: "http://purl.org/dc/terms/", term: TERM_VOCABULARY })]);

/** The scheme IRI path rule is the glossary tokens' own, so a concept's IRI and token name the same scheme. */
export { schemeIriPath };

function schemeName(scheme) {
  const section = scheme === "" ? ROOT_SCHEME_PATH : scheme.split("/").pop();
  const words = section.replace(/-services?(?:-section)?$/u, "").replace(/-/gu, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} glossary`;
}

function list(value) { return Array.isArray(value) ? value : [value]; }
function withoutContext({ "@context": _context, ...node }) { return node; }

/**
 * Whether a term may appear in a projection for `audience`. A term stating any `consent-status`
 * is gated and never projected; the public sees a term only when its carrier opted in.
 * @param {{visibility?: string, "consent-status"?: string}} record
 * @param {"public"|"authenticated"} audience
 */
export function glossaryAudienceAdmits(record, audience) {
  if (record["consent-status"] !== undefined) return false;
  return audience === "authenticated" || record.visibility === "public";
}

/**
 * Project a glossary index (`computer-glossary-index.v2`) into a SKOS vocabulary serialized as
 * JSON-LD: one concept scheme per owning section and one concept per admitted term the audience
 * may see, each a schema.org `DefinedTermSet` / `DefinedTerm` as well, so both SKOS and
 * schema.org consumers read it. Names become `prefLabel`, aliases `altLabel`, the body the
 * definition, the description the schema.org `description`, the identity the notation, and the
 * concept token (its semiotic content address, `glossary-token.mjs`) the `dct:identifier`.
 * Carrier-range relations resolve to the nearest concept in the section tree among those
 * projected; hierarchical predicates map to `skos:broader`/`skos:narrower`, every other one to
 * `skos:related`, and each also stays under its own house predicate (`term:<predicate>`).
 * Keywords (a compound term's constituents) map to `skos:broader`. Pure and deterministic: the
 * same index yields byte-identical output.
 * @param {{records: readonly object[]}} index
 * @param {{base?: string, audience?: "public"|"authenticated", pageOf?: (record: object) => string|undefined}} [options]
 *   `pageOf` names the page that presents a term, when one is published.
 * @returns {Readonly<{schema: string, audience: string, "@context": readonly unknown[], "@graph": object[], accounting: object}>}
 */
export function projectGlossarySkos(index, { base = DEFAULT_KNOWLEDGE_BASE, audience = "public", pageOf = () => undefined } = {}) {
  if (!index || !Array.isArray(index.records)) throw new TypeError("index must be a projected glossary index");
  if (typeof base !== "string" || !/^https?:\/\/.+\/$/u.test(base)) throw new TypeError("base must be an http(s) IRI ending in /");
  if (!GLOSSARY_AUDIENCES.includes(audience)) throw new TypeError(`audience must be one of ${GLOSSARY_AUDIENCES.join(", ")}`);
  const placed = index.records.filter((record) => typeof record.scheme === "string");
  const admitted = placed.filter((record) => glossaryAudienceAdmits(record, audience));
  // A term and a topic of one identity in one scheme are one concept (one IRI, one token): publish the first, count the rest.
  const seen = new Set();
  const records = admitted.filter((record) => { const key = `${record.scheme}\u0000${record.identity}`; if (seen.has(key)) return false; seen.add(key); return true; });
  const schemes = [...new Set(records.map((record) => record.scheme))].sort();
  const schemeIri = (scheme) => `${base}${schemeIriPath(scheme)}`;
  const conceptIri = (record) => `${schemeIri(record.scheme)}/${record.identity}`;
  const nearest = createNearestSchemeResolver(records);
  const accounting = { concepts: records.length, schemes: schemes.length, withheld: placed.length - admitted.length, refiledConcepts: admitted.length - records.length, relations: 0, unresolvedRelations: 0 };

  /** The concept a carrier-range assertion names, resolved to the nearest projected scheme (`createNearestSchemeResolver`). */
  function resolve(from, identity) {
    const target = nearest(from, identity);
    if (target) accounting.relations += 1; else accounting.unresolvedRelations += 1;
    return target && conceptIri(target);
  }

  const concepts = records.map((record) => {
    const links = { broader: new Set(), narrower: new Set(), related: new Set() };
    const house = {};
    for (const keyword of record.keywords ?? []) { const target = resolve(record, keyword); if (target) links.broader.add(target); }
    for (const [predicate, assertion] of Object.entries(record.relations ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
      if (RELATION_PREDICATE_RANGES[predicate] !== "carrier") continue;
      const targets = list(assertion).map((identity) => resolve(record, identity)).filter(Boolean);
      if (targets.length === 0) continue;
      house[`term:${predicate}`] = targets.map((target) => ({ "@id": target }));
      const kind = BROADER.has(predicate) ? "broader" : NARROWER.has(predicate) ? "narrower" : "related";
      for (const target of targets) links[kind].add(target);
    }
    const concept = withoutContext(definedTermJsonLd({
      id: conceptIri(record), url: pageOf(record), name: record.name, aliases: record.aliases, codes: [record.identity],
      description: record.description, definition: record.body, set: schemeIri(record.scheme),
      broader: [...links.broader].sort(), narrower: [...links.narrower].sort(), related: [...links.related].sort(),
    }));
    return { ...concept, ...(record.token ? { "dct:identifier": record.token } : {}), ...(record.type ? { "dct:type": record.type } : {}), ...house };
  });

  const sets = schemes.map((scheme) => withoutContext(definedTermSetJsonLd({ id: schemeIri(scheme), name: schemeName(scheme), codes: [scheme === "" ? ROOT_SCHEME_PATH : scheme] })));
  return Object.freeze({ schema: SCHEMA, audience, "@context": CONTEXT, "@graph": [...sets, ...concepts], accounting: Object.freeze(accounting) });
}
