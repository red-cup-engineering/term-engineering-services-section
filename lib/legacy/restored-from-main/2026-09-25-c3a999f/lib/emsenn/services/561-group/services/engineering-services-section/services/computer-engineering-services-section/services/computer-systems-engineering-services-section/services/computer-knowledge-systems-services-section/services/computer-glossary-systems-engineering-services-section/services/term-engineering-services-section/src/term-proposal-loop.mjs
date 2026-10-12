import { admitTermMarkdown, renderTermMarkdown } from "./term-carrier.mjs";

function request(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("proposal request must be an object");
  if (!Array.isArray(value.sources) || value.sources.length === 0) throw new TypeError("proposal request requires source witnesses");
  return Object.freeze({ ...value, sources: Object.freeze([...value.sources]) });
}

/**
 * Bounded inference seam. `propose` receives the source-bounded request and
 * prior deterministic findings; this owner never embeds a provider client.
 */
export async function proposeAndRepairTerm(input, { propose, fuel = 3, knownCompoundStems = [] } = {}) {
  const normalized = request(input);
  if (typeof propose !== "function") throw new TypeError("propose must be an inference operation");
  if (!Number.isSafeInteger(fuel) || fuel < 1) throw new TypeError("fuel must be a positive safe integer");
  const attempts = [];
  let findings = [];
  for (let turn = 1; turn <= fuel; turn += 1) {
    let candidate;
    try { candidate = await propose(Object.freeze({ request: normalized, priorFindings: Object.freeze(findings), turn })); }
    catch (error) {
      attempts.push(Object.freeze({ turn, disposition: "provider-failed", findings: Object.freeze([error.message]) }));
      break;
    }
    try {
      const { claims: _claims, filename, ...term } = candidate;
      const identity = filename.slice(0, -3);
      const markdown = renderTermMarkdown({ ...term, identity, provenance: { sources: normalized.sources } });
      const admitted = admitTermMarkdown({ text: markdown, filename });
      attempts.push(Object.freeze({ turn, disposition: "admitted", findings: Object.freeze([]) }));
      return Object.freeze({ disposition: "proposed", markdown, candidate: Object.freeze(candidate), admitted, attempts: Object.freeze(attempts) });
    } catch (error) {
      findings = (error.findings ?? [{ rule: "candidate", message: error.message }]).map((item) => `${item.rule}: ${item.message}`);
      attempts.push(Object.freeze({ turn, disposition: "refused", findings: Object.freeze(findings) }));
    }
  }
  return Object.freeze({ disposition: "refused", attempts: Object.freeze(attempts), findings: Object.freeze(findings) });
}
