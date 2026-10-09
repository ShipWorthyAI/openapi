---
"@shipworthy/overlay": minor
"@shipworthy/openapi-cli": patch
---

Generate typed Effect schemas from the vendored Overlay 1.0 and 1.1 YAML schemas and dispatch
actions using the declared feature version. Overlay 1.0 now rejects 1.1-only fields and primitive
targets, and appends array updates as single entries. Enforce the source schemas' unique actions
constraint. Add schema regeneration and drift checks and version-specific schema entry points.
