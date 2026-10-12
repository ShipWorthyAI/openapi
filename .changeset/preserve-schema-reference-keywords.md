---
"@shipworthy/openapi-parser": patch
"@shipworthy/overlay": minor
"@shipworthy/openapi-cli": minor
---

Preserve OpenAPI 3.1 schema keywords alongside `$ref` without introducing `allOf`
wrappers. Validate nested sibling schema references and retain sibling constraints
when dereferencing.

Add optional `strictTargets` overlay validation and the CLI `--strict-targets` flag
to reject action targets that match no nodes. Include supplier and Core overlay
examples that select operations and prune unused components.
