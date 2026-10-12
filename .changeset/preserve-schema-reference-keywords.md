---
"@shipworthy/openapi-parser": patch
"@shipworthy/overlay": minor
"@shipworthy/openapi-cli": minor
---

Preserve OpenAPI 3.1 schema keywords alongside `$ref` without introducing `allOf`
wrappers. Validate nested sibling schema references and retain sibling constraints
when dereferencing.

Collect unmatched and invalid JSONPath action targets with `applyOverlayWithWarnings`
and log them as CLI warnings while continuing to apply valid actions. Include
supplier and Core overlay examples that select operations and prune unused components.
