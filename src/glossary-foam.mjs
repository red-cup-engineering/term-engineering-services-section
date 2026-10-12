import { createSignGraph, glueSignGraphs } from "@red-cup-engineering/signcell/semantic-graph";
import { referenceOf } from "@red-cup-engineering/signcell/typed-mark";
import { RELATION_PREDICATE_RANGES } from "./term-carrier.mjs";
import { createNearestSchemeResolver } from "./glossary-index.mjs";
import { GLOSSARY_AUDIENCES, TERM_VOCABULARY, glossaryAudienceAdmits } from "./glossary-skos.mjs";
import {
  glossaryConceptToken, glossaryConceptType, glossaryDefinitionToken, glossaryDefinitionType,
  glossarySchemeToken, glossarySchemeType, glossarySignToken, glossarySignType, schemeIriPath,
} from "./glossary-token.mjs";

const SCHEMA = "computer-glossary-foam.v1";
const SKOS = "http://www.w3.org/2004/02/skos/core#";
/** The structural edges every admitted carrier contributes, by the SKOS predicate that already names each. */
export const FOAM_PREDICATES = Object.freeze({
  notation: `${SKOS}notation`, inScheme: `${SKOS}inScheme`, definition: `${SKOS}definition`, broader: `${SKOS}broader`,
});
const TARGET_TYPES = Object.freeze([glossaryConceptType.id, glossarySignType.id]);
const OBJECT_TYPES = Object.freeze({
  [FOAM_PREDICATES.notation]: [glossarySignType.id], [FOAM_PREDICATES.inScheme]: [glossarySchemeType.id],
  [FOAM_PREDICATES.definition]: [glossaryDefinitionType.id],
});
/** Every cut declares a predicate identically, so cuts glue without obstruction. */
const relationOf = (predicate) => Object.freeze({ id: predicate, subjectTypes: [glossaryConceptType.id], objectTypes: OBJECT_TYPES[predicate] ?? TARGET_TYPES, witnessTypes: [glossaryDefinitionType.id] });
const list = (value) => (Array.isArray(value) ? value : [value]);

function ok(result, what) {
  if (!result.ok) throw new Error(`${what} refused: ${result.refusal.code}: ${result.refusal.message}`);
  return result.value;
}

/**
 * Project a glossary index (`computer-glossary-index.v2`) into one semiotic foam: every admitted
 * term, concept and topic the audience may see becomes SignCell typed marks (its sign, its concept,
 * its definition and its scheme, see `glossary-token.mjs`) joined by witnessed SignGraph edges.
 * Each section's glossary is one graph cut with its own content address; the foam is the cuts glued
 * (`glueSignGraphs`), so sections that file the same sign or relate to each other's concepts share
 * those tokens. Each edge is witnessed by the definition that asserts it.
 *
 * Carrier-range relations and keywords resolve to the nearest projected concept in the section
 * tree (`createNearestSchemeResolver`, the same rule the SKOS projection uses). A target no
 * projected concept answers lands on its sign instead, so no assertion is lost, and the signs that
 * relations reach but no concept defines are reported as `wanted`. A concept filed twice in one
 * scheme (a term and a topic of one identity, say) keeps both definitions and is reported.
 * Pure and deterministic: the same index yields byte-identical output.
 * @param {{records: readonly object[]}} index
 * @param {{audience?: "public"|"authenticated"}} [options]
 */
export function projectGlossaryFoam(index, { audience = "public" } = {}) {
  if (!index || !Array.isArray(index.records)) throw new TypeError("index must be a projected glossary index");
  if (!GLOSSARY_AUDIENCES.includes(audience)) throw new TypeError(`audience must be one of ${GLOSSARY_AUDIENCES.join(", ")}`);
  const placed = index.records.filter((record) => typeof record.scheme === "string");
  const records = placed.filter((record) => glossaryAudienceAdmits(record, audience));
  const nearest = createNearestSchemeResolver(records);
  const accounting = { definitions: records.length, withheld: placed.length - records.length, relations: 0, resolvedRelations: 0, unresolvedRelations: 0, unaddressableTargets: 0 };
  const wanted = new Map();
  const bySchemes = new Map();
  for (const record of records) bySchemes.set(record.scheme, [...(bySchemes.get(record.scheme) ?? []), record]);

  const cuts = [];
  for (const scheme of [...bySchemes.keys()].sort()) {
    const cells = new Map(), edges = new Map(), predicates = new Set();
    const cell = (token) => { cells.set(token.id, token); return referenceOf(token); };
    const edge = (subject, predicate, object, witness) => {
      predicates.add(predicate);
      edges.set(`${subject.id} ${predicate} ${object.id} ${witness.id}`, { subject, predicate, object, witness });
    };
    const schemeToken = cell(glossarySchemeToken(scheme));
    for (const record of bySchemes.get(scheme)) {
      const concept = cell(glossaryConceptToken(record.scheme, record.identity));
      const definition = cell(glossaryDefinitionToken(record));
      edge(concept, FOAM_PREDICATES.notation, cell(glossarySignToken(record.identity)), definition);
      edge(concept, FOAM_PREDICATES.inScheme, schemeToken, definition);
      edge(concept, FOAM_PREDICATES.definition, definition, definition);
      const targetOf = (identity) => {
        accounting.relations += 1;
        const target = nearest(record, identity);
        if (target) { accounting.resolvedRelations += 1; return cell(glossaryConceptToken(target.scheme, target.identity)); }
        accounting.unresolvedRelations += 1;
        wanted.set(identity, (wanted.get(identity) ?? 0) + 1);
        return cell(glossarySignToken(identity));
      };
      for (const keyword of record.keywords ?? []) edge(concept, FOAM_PREDICATES.broader, targetOf(keyword), definition);
      for (const [predicate, assertion] of Object.entries(record.relations ?? {})) {
        if (RELATION_PREDICATE_RANGES[predicate] !== "carrier") continue;
        for (const identity of list(assertion)) {
          // A target that is not a carrier identity (free text, a link) names no sign; it stays in the definition and is counted.
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(identity)) { accounting.unaddressableTargets += 1; continue; }
          edge(concept, `${TERM_VOCABULARY}${predicate}`, targetOf(identity), definition);
        }
      }
    }
    const graph = ok(createSignGraph({ cells: [...cells.values()], relations: [...predicates].sort().map(relationOf), edges: [...edges.values()] }), `cut ${scheme}`);
    cuts.push({ scheme, graph });
  }

  const glued = cuts.length === 0
    ? { graph: ok(createSignGraph({ cells: [], relations: [], edges: [] }), "empty foam"), obstructions: [] }
    : ok(glueSignGraphs(...cuts.map(({ graph }) => graph)), "foam");
  const definitionsOf = new Map();
  for (const record of records) definitionsOf.set(record.token, [...(definitionsOf.get(record.token) ?? []), record]);
  const diagnostics = [...definitionsOf.values()].filter((group) => group.length > 1).map((group) => Object.freeze({
    code: "concept-defined-more-than-once", concept: group[0].token, scheme: schemeIriPath(group[0].scheme), identity: group[0].identity,
    facets: Object.freeze(group.map((record) => record.facet).sort()),
  })).sort((left, right) => left.scheme.localeCompare(right.scheme) || left.identity.localeCompare(right.identity));
  const definedSigns = new Set(records.map((record) => record.identity));
  const kinds = (type) => glued.graph.cells.filter((each) => each.type === type).length;
  return Object.freeze({
    schema: SCHEMA,
    audience,
    foam: glued.graph,
    cuts: Object.freeze(cuts.map(({ scheme, graph }) => Object.freeze({ scheme: schemeIriPath(scheme), id: graph.id, cells: graph.cells.length, edges: graph.edges.length }))),
    obstructions: glued.obstructions,
    wanted: Object.freeze([...wanted].filter(([identity]) => !definedSigns.has(identity)).map(([identity, count]) => Object.freeze({ identity, sign: glossarySignToken(identity).id, wantedBy: count }))
      .sort((left, right) => right.wantedBy - left.wantedBy || left.identity.localeCompare(right.identity))),
    diagnostics: Object.freeze(diagnostics),
    accounting: Object.freeze({
      ...accounting, signs: kinds(glossarySignType.id), concepts: kinds(glossaryConceptType.id), schemes: kinds(glossarySchemeType.id),
      cells: glued.graph.cells.length, edges: glued.graph.edges.length,
    }),
  });
}
