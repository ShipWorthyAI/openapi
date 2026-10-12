# Replacing Hotels' OpenAPI workspace package

Investigated on 2026-10-12. ShipWorthy checkout: `main` at
`1bb10d389bdae55a442c214e5239212b3062b079`. Hotels checkout:
`/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service`,
`main` at `dac9dcfd8556ff2cc6ac50654c237784f9e01586`.

## Conclusion

The Hotels package can be removed after resolving the demonstrated Go generation
incompatibility and migrating its build integrations. Following Reservations'
separate generated public/internal contract packages removes the need for the
runtime composition step entirely. ShipWorthy overlays can also replace the
current supplier overlay/filter tooling after translating its filter configuration
and preserving checks for unmatched actions.

The initial investigation changed no implementation, dependency, contract, or
generated artifact. Its probe outputs are in `/tmp/hotels-openapi-bundle.jtdqTe`.

## Implementation outcome

The subsequent implementation removes the schema sibling wrapper, validates
references inside sibling keywords, and preserves sibling constraints during
dereferencing. Hotels' pinned strict `ogen` now succeeds, with all 15 generated
server files identical to the baseline; its Go client retains the original named
model fields.

[examples/overlays](../../examples/overlays/README.md) contains the three original
Nuitee inputs and the complete Core snapshot matching Hotels' recorded source
SHA-256. The four copied overlays use standard operation-removal actions in
place of `x-filter`. The new optional `--strict-targets` flag preserves checks
for unmatched actions. All four outputs pass Hotels' pinned Go client generator;
the example includes seven tests for selection, corrections, authentication,
and agreement with CLI-generated artifacts. The repository's `bun run check`
passes. The Hotels runtime-contract migration remains separate work.

## What the package does

| Responsibility                   | Current implementation                                                                                                              | CLI replacement                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Bundle public and internal roots | Two sequential calls from `src/cli.ts`                                                                                              | Two `openapi bundle <input> <output>` calls                                          |
| Produce runtime contract         | Merge raw roots, prefix paths from servers, reject conflicts, resolve shared schemas together, apply per-contract security defaults | Requires separate composition before bundling                                        |
| Detect stale artifacts           | Compare generated text with committed text without writing                                                                          | No `bundle --check`; bundle into temporary files and compare, or add this capability |
| Write artifacts atomically       | Temporary file and rename                                                                                                           | CLI writes directly; retain a temporary-output/rename wrapper if required            |
| Disable HTTP refs                | `resolve.http: false`                                                                                                               | CLI has no resolver policy flags; public `bundleDocument` options expose only `cwd`  |
| Rebuild docs during development  | Vite plugin calls `generate` on startup and YAML/mapping changes                                                                    | Replace calls while preserving refresh and error reporting                           |
| Supply supplier tooling          | Hosts `openapi-format@1.33.7`                                                                                                       | Move this dependency and its invocation paths separately                             |

Sources: Hotels [bundle.ts](/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service/packages/openapi/src/bundle.ts:18),
[cli.ts](/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service/packages/openapi/src/cli.ts:6),
[runtime.ts](/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service/packages/openapi/src/runtime.ts:80),
[docs plugin](/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service/apps/docs/tooling/docs-plugin.ts:14),
[package manifest](/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service/packages/openapi/package.json:21).
ShipWorthy [bundle command](../../packages/openapi-cli/src/commands/bundle/command.ts),
[bundle API](../../packages/openapi-parser/src/bundle.ts), and
[load options](../../packages/openapi-parser/src/load.ts).

The runtime composition matters because public paths use `/v1` and internal
paths use `/internal/v1`. The composed document uses server `/` and explicitly
assigns missing operation security from the originating contract. Merging
already bundled roots also needs care with shared component names; the current
implementation intentionally resolves both raw roots together. `ogen` consumes
this runtime contract rather than either standalone contract.
Sources: [runtime.ts](/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service/packages/openapi/src/runtime.ts:80),
[Makefile](/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service/Makefile:159).

## Actual contract and generator probes

Fresh Stoplight outputs were byte-for-byte identical to all three checked-in
Hotels bundles. Fresh baseline Go client/server generation was also identical
to the checked-in generated Go files. This establishes a current baseline.

| Probe                                                   | Result                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| CLI bundles authored public YAML                        | Passed; 9 paths, 51 schemas, no external refs                      |
| CLI bundles authored internal YAML                      | Passed; 1 path, 43 schemas, no external refs                       |
| CLI rebundles existing composed runtime JSON            | Passed; 10 paths, 64 schemas, no external refs                     |
| Pinned `oapi-codegen` consumes new public bundle        | Generation passed, but named model fields became anonymous structs |
| Pinned strict `ogen` consumes baseline runtime          | Passed; all 15 generated Go files matched checked-in files         |
| Pinned strict `ogen` consumes CLI runtime output        | Failed: `anonymous type name conflict: "BookingPolicies"`          |
| Restore only description siblings in CLI runtime output | Passed; all 15 generated Go files matched the baseline exactly     |

The runtime probe starts from the existing composed runtime document. It tests
bundler compatibility; it does not establish that the CLI performs composition.
No Ruby generation, browser rendering, service compilation, or booking behavior
was tested. The current blocker is sufficient to reject a direct migration.

The outputs remain OpenAPI 3.1.0. Structural comparison found 73 changed leaf
entries for public, 69 for internal, and 105 for runtime; these counts include
separate additions/removals for each representation change. Observed changes
include `example` becoming `examples`, and `$ref` description siblings becoming:

```json
{
  "allOf": [
    { "$ref": "#/components/schemas/BookingPolicies" },
    {
      "description": "Supplier fulfillment cancellation policies when available; otherwise the accepted policies."
    }
  ]
}
```

The client changes include `Booking.Holder` changing from `*Guest` to an
anonymous struct and `Booking.Policies` changing from `*BookingPolicies` to an
anonymous struct. Restoring the 21 description-only wrappers in the runtime
output to `$ref` plus sibling `description` eliminates the strict `ogen` failure
without reverting the example conversions. That isolates the incompatible
normalization. It is a diagnostic control, not a proposed output patch.

The rewrite is explicit in ShipWorthy
[normalizeSchema/liftSiblings](../../packages/openapi-parser/src/pipeline.ts).
The pinned generator versions and arguments come from Hotels
[go.mod](/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service/go.mod:20),
[ogen config](/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service/internal/contracts/v1/ogen.yml:1),
and [Makefile](/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service/Makefile:144).

Representative commands, run with all outputs redirected to the probe directory:

```sh
# From ShipWorthy:
bun packages/openapi-cli/src/bin.ts bundle \
  /Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service/api/v1/public.openapi.yaml \
  /tmp/hotels-openapi-bundle.jtdqTe/public.shipworthy.json

# From Hotels:
go tool ogen -strict -config internal/contracts/v1/ogen.yml -package v1 \
  -target /tmp/hotels-openapi-bundle.jtdqTe/ogen-shipworthy \
  /tmp/hotels-openapi-bundle.jtdqTe/runtime.shipworthy.json
go tool oapi-codegen --config=client/client.cfg.yaml \
  -o /tmp/hotels-openapi-bundle.jtdqTe/client-shipworthy.go \
  /tmp/hotels-openapi-bundle.jtdqTe/public.shipworthy.json
```

The [npm registry's current CLI metadata](https://registry.npmjs.org/@shipworthy%2fopenapi-cli/latest)
returned version `0.0.1`, with Node requirement `>=22.19.0`. Hotels pins Node
`24.17.0`, so the runtime requirement is satisfied.
[Hotels mise.toml](/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service/mise.toml:6).
The actual published CLI was run from the probe directory under Node using
`npm exec --yes --package=@shipworthy/openapi-cli@0.0.1 -- openapi bundle ...`.
Its public, internal, and runtime outputs matched the local CLI outputs
byte-for-byte. A Bun invocation
was blocked by this machine's configured 259200-second minimum release age;
that setting was left unchanged.

## Migration work after compatibility is fixed

1. Correct ShipWorthy's annotation-only `$ref` normalization, with regression
   coverage for downstream generator compatibility. Verify both pinned Hotels
   Go generators before release. Decide whether `bundle` should also support
   drift checking, atomic writes, and local-only reference resolution.
2. Follow Reservations: generate public routes into `internal/contracts/v1`
   and internal routes into `internal/contracts/internalv1`, with separate server
   adapters and route mounts. Remove the runtime compositor and its generated
   bundle. Shared source schemas produce distinct Go types in the two packages;
   adapt the Hotels handlers and conversions that currently rely on one package.
3. Add a pinned CLI dev dependency at the Hotels root and replace
   `openapi:bundle` / `openapi:check`. A temporary-output comparison can preserve
   checks without depending on a new CLI flag.
4. Replace the docs plugin's programmatic calls with shared orchestration or CLI
   invocation, preserving sequential rebuilds, live reloads, and errors.
5. Replace Core/Nuitee `openapi-format` calls with ShipWorthy overlays. Translate
   `x-filter.inverseOperationIds` to operation-removal actions and enable
   `--remove-unused-components`. Preserve Nuitee's unmatched-action check, which
   the current ShipWorthy CLI does not expose. Choose JSON output or separately
   handle Core's existing YAML output. Remove the `openapi-format` dependency.
6. Remove the docs workspace dependency, package Docker copy/context entries,
   Compose package mount/volume, and package lockfile importer; update tooling
   documentation. The Go service Dockerfile consumes generated Go and needs no
   new Node runtime.
7. Regenerate and verify both contracts, Go server/client, Ruby SDK, docs,
   supplier workflows, and drift checks before deleting the package.

Integration sources: Hotels
[root package.json](/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service/package.json:11),
[docs package.json](/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service/apps/docs/package.json:18),
[Core Make targets](/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service/Makefile:182),
[Nuitee script](/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service/integrations/bookings/adapters/nuitee/openapi/scripts/nuitee-sdk.sh:18),
[docs Dockerfile](/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service/apps/docs/Dockerfile:7),
and [Compose](/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service/docker-compose.yml:15).

## Follow-up: Reservations pattern and supplier overlays

Reservations generates its public bundle into `internal/contracts/v1` and its
internal bundle into `internal/contracts/internalv1`, using separate `ogen`
invocations. This is a supported alternative to Hotels' current combined runtime
package; the runtime merge is an implementation choice rather than an inherent
bundling requirement.
[Reservations Makefile](/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-reservation-service/Makefile:103).

The current Core/Nuitee pipelines use `openapi-format` for overlays followed by
operation selection and unused-component pruning. The `x-filter` object is
configuration for that tool, not an Overlay action consumed by ShipWorthy.
ShipWorthy's documented equivalent is a removal selector for operations outside
the allowlist, followed by `--remove-unused-components`.
[Overlay filtering documentation](../../packages/openapi-overlay/README.md).

Temporary copies of all three Nuitee overlays were translated by removing
`x-filter` and appending the equivalent operation-removal action. Each CLI run
succeeded, retained exactly the selected operation IDs (1 search, 9 booking,
4 hotel-data), and its resulting document passed the pinned `oapi-codegen`
generation command. Outputs are in the probe directory's `overlays/` folder.
The original upstream documents are OpenAPI 3.0.0; ShipWorthy upgrades them to
3.1.0 before overlaying. These probes establish operation selection and
generation, not complete generated-client or request/response equivalence.

The remaining behavior difference is the existing Nuitee script's rejection of
unused overlay actions. ShipWorthy permits targets with no matches, and its CLI
does not report matched-action counts. Preserve that guard when migrating.
Core also currently writes YAML; ShipWorthy's overlay command always writes JSON.
Sources: [Nuitee script](/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service/integrations/bookings/adapters/nuitee/openapi/scripts/nuitee-sdk.sh:18),
[Core overlay](/Users/lott/gitlab.inkind-dev.com/engineering/services/inkind-hotel-service/integrations/core/openapi/core.overlay.json),
and [CLI overlay implementation](../../packages/openapi-cli/src/commands/overlay/command.ts).

For OpenAPI 3.1 Schema Objects, preserve annotation keywords alongside `$ref`
instead of introducing description-only `allOf` branches. This form is permitted
by [JSON Schema 2020-12 reference semantics](https://json-schema.org/draft/2020-12/json-schema-core#ref),
which [OpenAPI 3.1 Schema Objects](https://spec.openapis.org/oas/v3.1.0.html#schema-object)
follow. Both representations can accept the same instances, but generators use
their structural differences when assigning model identities.
