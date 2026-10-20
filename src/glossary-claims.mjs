/**
 * The source-authorized glossary foam is the producer: this is only its
 * witnessed SignGraph edges read as native SignCell claims. Never turn
 * terminology into an independently asserted RDF triple or a truth verdict.
 * The attached definition token is a witness that the carrier SAYS this,
 * not independent corroboration that the proposition holds.
 *
 * Actor and visibility admission must happen before a foam is supplied here.
 * This reader neither selects another actor nor opens a hidden corpus.
 */
import { querySignGraph } from "@red-cup-engineering/signgraph/semantic-graph";
import { createSignClaim, joinClaimsKnowledge } from "@red-cup-engineering/signcell/semantic-claim";
import { address, sectionReading } from "@red-cup-engineering/signcell/cell";
import { referenceOf } from "@red-cup-engineering/signcell/typed-mark";
import { glossaryConceptToken } from "./glossary-token.mjs";

const reject = reason => { throw new TypeError("glossary claims: " + reason); };

/**
 * Query a genuine SignCell concept token within an already-projected
 * audience-admitted semiotic foam, optionally selecting a predicate.
 * Returns canonical source-witnessed claims (FOUR presence arises naturally
 * from the original evidence sides) and each original SignGraph EAVT edge.
 * Absence is not denial; no "against" is fabricated from wording or gaps.
 * There is no second statement store and no cloned relation evaluator.
 */
export function glossaryClaimsAt(foam, selector) {
  if (!foam || foam.schema !== "computer-glossary-foam.v1" ||
      !["public", "authenticated"].includes(foam.audience) || !foam.foam ||
      !selector || typeof selector !== "object" || Array.isArray(selector) ||
      Reflect.ownKeys(selector).some(key => typeof key !== "string" ||
        !["scheme", "identity", "predicate"].includes(key) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(selector, key), "value")) ||
      typeof selector.scheme !== "string" ||
      typeof selector.identity !== "string" ||
      (selector.predicate !== undefined &&
        (typeof selector.predicate !== "string" || !selector.predicate)))
    reject("requires an admitted foam and exact scheme, identity, optional predicate");
  const concept = referenceOf(glossaryConceptToken(selector.scheme, selector.identity));
  // The SignGraph original indexed reader owns the typed-membership and
  // predicate selection: a missing/foreign concept refuses, not empty truth.
  const edges = querySignGraph(foam.foam, concept,
    selector.predicate === undefined ? {} : { predicate: selector.predicate });
  const claims = new Map(), original = new Map();
  for (const { id, edge } of edges) {
    const admitted = createSignClaim({
      subject: edge.subject, predicate: edge.predicate, object: edge.object,
      for: [edge.witness], against: [],
    });
    if (!admitted.ok) reject("original SignGraph edge did not admit a SignCell claim");
    const key = address(admitted.value);
    const prior = claims.get(key);
    if (prior) {
      const joined = joinClaimsKnowledge(prior, admitted.value);
      if (!joined.ok) reject("original SignCell knowledge join refused");
      claims.set(key, joined.value);
    } else claims.set(key, admitted.value);
    const references = original.get(key) ?? [];
    references.push(Object.freeze({ edge: id, witness: edge.witness }));
    original.set(key, references);
  }
  const keys = [...claims.keys()].sort();
  const cells = Object.freeze(keys.map(key => claims.get(key)));
  return Object.freeze({
    kind: "computer-glossary-signcell-readings.v1",
    audience: foam.audience, graph: foam.foam.id, concept,
    cells, section: sectionReading(cells),
    sources: Object.freeze(keys.map(key => Object.freeze({
      claim: key, edges: Object.freeze(original.get(key)),
    }))),
    // These edges are SOURCE TELLINGS, not verified domain truths, proof
    // of kinematic realizability, an Actor knowledge grant, or a denial.
    sourceStatementsOnly: true, knowledgeTruthEstablished: false,
    relationToKinematicPointProved: false,
  });
}
