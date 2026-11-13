# Zod generator follow-ups

- **Lazy validators:** Generated modules currently compile every component validator at import. Measure the import cost on a service with many components, then consider lazy compilation while preserving the public exports.
- **Plain Zod output:** Explore emitting `z.object(...)` and related expressions so generated validators do not depend on the experimental `z.fromJSONSchema` and `z.compile` APIs or one exact Zod version.
- **Response validators:** Add opt-in per-operation response validators, including status and media-type selection, instead of only component and JSON request-body validators.
