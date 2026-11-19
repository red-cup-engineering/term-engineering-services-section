---
title: Vocabulary Audit Notes — 2026-03-04
---
Spot-check of 10 of 69 canonical terms in `relationality/terms/`.

## Strengths

- Frontmatter is perfectly uniform: title, date-created, type: term, tags, derived-in (step + proof ref), defines
- All files use correct relative markdown links (no wikilinks)
- All files reference `the-incitement-argument.md` in derived-in.proof
- Writing quality and formatting consistency is high (PTGAE register)
- Derivation chain cross-linking within terms/ is thorough

## Gaps to address (future work)

### Mathematical system cross-links
Only 1 of 10 files (fixed-point.md) links to formal mathematics at `mathematics/`.
Steps 10, 14, and 17 especially should link to: - term.md → lambda calculus concepts - flow.md → closure operators, modal operators - nucleus.md → closure operators, the Closure term from step 3 - observable.md, measurement.md → physics concepts in disciplines/mathematics/ - ALL step 14-17 terms → the five mathematical systems concept document

### Tags
All term files have `tags: []`.
Should add 3-5 CamelCase tags per file using controlled vocabulary at `content/tags/`.
Most would get `Relationality` at minimum.

### Mathematical system attribution
Each term should note which mathematical system(s) formalize it: - Steps 1-9 terms: foundational, pre-formal - Steps 10-12 terms: Semiotic Universe - Steps 14-15 terms: QCHTTopos (structural side), Semiotic Universe (processual side) - Step 17 terms: Dynamical Universe (evolution), Spectral Universe (measurement)

### Inducing/inciting vocabulary
The term files and the forcing argument still use "forced/forcing."
Future pass should update to "incited/inciting" consistently.
