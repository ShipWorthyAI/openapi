---
"@shipworthy/openapi-cli": minor
---

Add `--overlay` and `--remove-unused-components` to `openapi generate`. The input is bundled, the overlay is applied, and code is generated from the result in one command, so an intermediate overlaid file is no longer needed:

```sh
openapi generate typescript tanstack-query -i https://example.com/openapi.yaml --overlay ./openapi/api.overlay.yaml --remove-unused-components -o ./src/generated/api
```

Overlay warnings go to stderr, as with `openapi overlay`. Stamps and `--check` use the overlaid document. `--remove-unused-components` without `--overlay` fails with a usage error. Stdin input works with `--overlay` too.
