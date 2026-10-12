# OpenAPI Overlay examples

Apply reviewed corrections and select operations from local OpenAPI snapshots using
`@shipworthy/openapi-cli`. The examples cover Nuitee search, booking, hotel data, and Core
hotel payments. They require no supplier credentials or network requests.

From the repository root:

```sh
bun install
bunx turbo run generate test --filter=@shipworthy/example-overlays
```

To generate one selected contract from this directory:

```sh
bun run generate:search
```

The equivalent CLI command is:

```sh
bunx --bun @shipworthy/openapi-cli overlay openapi/nuitee/search.json \
  --overlay overlays/nuitee/search.overlay.json \
  --remove-unused-components \
  -o generated/nuitee/search.openapi.json
```

`generate` processes all four documents and writes OpenAPI 3.1 JSON to `generated/`.
The upstream snapshots are OpenAPI 3.0; the CLI bundles and upgrades them before applying
the overlay. All corrections use standard Overlay 1.1 actions. Operation selection uses
JSONPath removal actions, and `--remove-unused-components` prunes paths without operations
and components unreachable from the selected contract. Invalid or unmatched action targets
produce CLI warnings; subsequent valid actions still run. The example tests assert that
these correction overlays produce no target warnings.

| Input                            | Overlay                                   | Selected operations                                                                       | Output                                     |
| -------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| `openapi/nuitee/search.json`     | `overlays/nuitee/search.overlay.json`     | `searchHotelRates`                                                                        | `generated/nuitee/search.openapi.json`     |
| `openapi/nuitee/booking.json`    | `overlays/nuitee/booking.overlay.json`    | Nine prebook and booking operations                                                       | `generated/nuitee/booking.openapi.json`    |
| `openapi/nuitee/hotel-data.json` | `overlays/nuitee/hotel-data.overlay.json` | `searchPlaces`, `getPlace`, `listHotels`, `getHotel`                                      | `generated/nuitee/hotel-data.openapi.json` |
| `openapi/core/openapi.yaml`      | `overlays/core/core.overlay.json`         | `authorizeHotelPayment`, `getHotelPayment`, `finalizeHotelPayment`, `releaseHotelPayment` | `generated/core.openapi.json`              |

The Nuitee overlays correct operation IDs, payment method types, decimal amounts, and
optional fields present in supplier responses. The Core overlay changes document metadata,
removes the unrelated partner-service authentication scheme, and retains only hotel payment
operations and their dependencies. The source overlays used `openapi-format`'s `x-filter`
configuration; these copies replace it with standard removal actions.

Tests apply the overlays to the snapshots, check there are no target warnings, verify the exact
operation selections and key contract corrections, and compare the result with the CLI
artifacts. The repository's root `bun run check` includes these tests and regenerates the
artifacts first through the example's Turbo task dependencies.

## Snapshot provenance

Inputs and correction overlays were copied from the Hotels service's checked-in supplier
contracts on 2026-10-12. The Nuitee snapshots were retrieved on 2026-09-04 from:

- [Search](https://docs.liteapi.travel/openapi/api-search.json)
- [Booking](https://docs.liteapi.travel/openapi/api-booking.json)
- [Hotel data](https://docs.liteapi.travel/openapi/api-hotel-data.json)

Their SHA-256 hashes are:

```text
e25f6c2cadf41a7f919858fd1b02aef198a38c16b9a7629bfc15f7786c1177fc  openapi/nuitee/search.json
be0a225b577c94c250a7bf076a405e51094a859bf2522e77663000bd8a48e247  openapi/nuitee/booking.json
501406e9952d65a7278048f3fcced3afd91cd1f9155275704eea893c18ea2a97  openapi/nuitee/hotel-data.json
```

The Core input is the complete generated `swagger/internal_v1/swagger.yaml` snapshot used
by Hotels' payment integration, rather than its already filtered output. Hotels records the
source as Core commit `0ca834249d81f66ae4fa9559cf4d1aa051ec03dc`; the copied document matches
its recorded SHA-256:

```text
41806ab0e01d6cb0cb2b4e48c4c410e911034835e3d4222c0d2756ed98428d9c  openapi/core/openapi.yaml
```

The input snapshots retain their original bytes. Update the snapshots and their hashes
together, then regenerate and verify the selected contracts.
