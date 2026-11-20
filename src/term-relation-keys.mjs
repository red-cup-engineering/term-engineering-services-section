import { AUTHORIZED_RELATION_PREDICATES, admitTermMarkdown, recognizeTermMarkdown, renderTermMarkdown } from "./term-carrier.mjs";
import { planTermMigration } from "./term-migration.mjs";
import { writeTerm } from "./term-operations.mjs";

/** Relation predicates come from an explicit vocabulary, never glossary filenames. */
export async function resolveTermRelationAuthority({ paths = [] } = {}) {
  const predicates = Object.freeze([...AUTHORIZED_RELATION_PREDICATES]);
  return Object.freeze({ relationKeysByPath: Object.freeze(Object.fromEntries(paths.map((path) => [path, predicates]))), predicates });
}
const options = (input = {}) => ({ ...input, authorizedRelationKeys: AUTHORIZED_RELATION_PREDICATES });
export async function recognizeTermMarkdownInVault({ path, text, ...rest } = {}) { return recognizeTermMarkdown(options({ ...rest, text, filename: rest.filename ?? path.slice(path.lastIndexOf("/") + 1) })); }
export async function admitTermMarkdownInVault({ path, text, ...rest } = {}) { return admitTermMarkdown(options({ ...rest, text, filename: rest.filename ?? path.slice(path.lastIndexOf("/") + 1) })); }
export async function renderTermMarkdownInVault({ term } = {}) { return renderTermMarkdown(term); }
export async function writeTermInVault(request = {}, operations = {}) { return writeTerm({ ...request, authorizedRelationKeys: AUTHORIZED_RELATION_PREDICATES }, operations); }
export async function planTermMigrationInVault(sources, { convertOrgToGfm } = {}) { return planTermMigration(sources, { convertOrgToGfm, relationKeysBySource: Object.fromEntries(sources.map(({ relativePath }) => [relativePath, AUTHORIZED_RELATION_PREDICATES])) }); }
