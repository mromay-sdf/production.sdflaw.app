# Architecture and initial codebase review

## Existing code inspected before implementation

- Production workspace was empty; no working application was replaced.
- Neighboring `../PDF` uses React 19, TypeScript, Vite, `pdf-lib` 1.17.1, and Vitest. Its engine parses unencrypted PDFs, copies vector pages, embeds Base14 font choices, and computes text placement using CropBox origin and normalized 0/90/180/270-degree rotation. It supports sequential separate-file and merged output and validates digit overflow.
- The supplied SDF UI 1.1 package provides tokens, base/component/layout CSS, theme script, official black/white logos, an example shell, and design references. It is a CSS/asset system, not a React component library. Production uses the official tokens/base CSS and logos and composes accessible React controls around them. Source Sans 3 is copied from the existing PDF application and self-hosted.
- Existing Bates source and its tests are copied unchanged into `shared/sdf-pdf`. Production's adapter changes generated producer metadata, saves outputs server-side, and uses the inherited unique filename helper. It does not implement a second placement or stamping algorithm. The neighboring app is unchanged. See `shared/sdf-pdf/PROVENANCE.md` and the verification script.

## Architecture chosen

React/TypeScript/Vite frontend; Express/Node 24 API; PostgreSQL for production records; private Azure Blob Storage for bytes. The developer mode uses SQLite and filesystem blobs with the same service interfaces. Azure App Service runs the supplied container. This explicitly follows the requested Azure architecture rather than static or Sites hosting.

The API verifies Entra v2 access tokens rather than trusting forwarded identity headers. MSAL uses authorization-code/PKCE flows in the browser. The API checks signature, expiry, issuer, audience, tenant, authorized SPA client, object ID, and `access_as_user` scope. App assignment in Entra constrains the authorized population to SDF employees.

## Persistent data model

`Production` is the aggregate root, with a UUID, revision, names/description, creator identity, timestamps, status, Bates settings, optional external matter ID, document records, tags, processed-file manifest, validation, publication reference, and export history.

`ProductionDocument` has its own UUID, immutable original storage reference and SHA-256, generated storage reference and SHA-256, original/final/display names, source byte count, pages, numeric and formatted Bates endpoints, description, date, tag IDs, problem state, and source provider/external IDs. Structured Bates numbers never depend on parsing filenames.

`Tag` has a production-scoped UUID and editable unique name. `DocumentTag` is represented by each document's tag-ID collection. This provides the required many-to-many relationship without a separate first-version SQL join table.

`ValidationResult` stores timestamp, revision, and individual success/warning/error checks. Validation compares document ranges, hashes, page counts, processed-file manifest, and physical blob availability.

`ProductionExport` stores UUID, author, kind, time, revision, immutable snapshot ID, and an optional downloadable artifact key. Snapshots are separate immutable database records. They capture all metadata, tags, settings and immutable PDF references. Historical exports remain downloadable.

PostgreSQL schema:

- `productions(id, revision, payload)` — structured aggregate serialized as JSON text.
- `snapshots(id, production_id, payload)` — immutable snapshot aggregates with foreign key.
- `production_members(production_id, principal_id, role)` — reserved membership table for later production-level ACLs; **not enforced in the MVP**.
- `blob_deletions(key)` — durable file cleanup queue populated atomically when deleting a production and its snapshots. Private objects are deleted in batches, retrying transient failures at startup and every minute. Azure soft-delete/version/backup retention still applies. Previously abandoned, unreferenced blobs are outside this queue.

JSON aggregates keep cross-document numbering and metadata commits atomic. Records are structured in code; they are not filenames or browser-local state. This design can be normalized into separate document/tag tables if reporting or production volume justifies it. No automatic schema-changing migrations are needed in this first schema; later releases must add explicit versioned migrations.

## Concurrency and failure behavior

All production mutations require `If-Match` with the current numeric revision. PostgreSQL obtains a row lock; SQLite serializes reads/writes and uses `BEGIN IMMEDIATE`. Stale operations return 409. Source changes invalidate generated outputs. All output references commit together: failures leave the prior saved production unchanged. A batch of uploads commits each file independently, making partial success visible.

Objects are written under new random keys and are never overwritten. An interrupted operation can leave unreachable blobs. No garbage collector deletes them automatically: retention must eventually account for current records and all historical snapshots. The active processed-file manifest detects PDF/index mismatches; storage-level abandoned objects are not counted as active production documents.

The first release processes within bounded HTTP requests, with at most two expensive operations admitted per application instance. There is no distributed background job queue, resumable upload, or durable progress scheduler. Large PDF operations may hit App Service request timeouts; load-test the chosen tier. For larger workloads, extract processing into a queue-backed worker while retaining the same adapters and commit protocol.

## Routes

| UI route | Purpose |
| --- | --- |
| `/` | Productions table and creation |
| `/productions/{uuid}/Documents` | Upload, order, remove, production details |
| `/productions/{uuid}/Bates` | Settings and labeling |
| `/productions/{uuid}/Index` | Editable index and search |
| `/productions/{uuid}/Tags` | Tag management and bulk tagging |
| `/productions/{uuid}/Validate` | Validation report |
| `/productions/{uuid}/Viewer` | Workspace review |
| `/productions/{uuid}/Publish` | Publish/unpublish and export history |
| `/p/{uuid}` | Immutable published attorney viewer |

All document and export URLs use opaque IDs. Authenticated fetch retrieves PDF bytes, then creates a temporary browser blob URL. No bearer tokens, filenames, clients, or matters are placed in API URLs. The static sign-in shell can load unauthenticated; no production data can.

## Preview and offline behavior

The internal viewer bundles PDF.js, its worker, font data, CMaps, and WASM assets. It renders pages to canvas, supports page navigation and zoom, and retains direct open/download controls. The index remains visible while changing documents. Search covers names, descriptions, tags, range endpoints, and full Bates labels inside a document's numeric range. There is no OCR or cross-PDF full-text search.

Offline output uses a regular script `assets/data.js`, not `fetch` or ES modules. Metadata is serialized safely and inserted via `textContent`. PDFs use encoded relative paths. CSS, Source Sans 3, logo, index metadata, and JavaScript are local. Native browser PDF preview is attempted; direct Open PDF links remain available when local embedding is blocked. Clipboard APIs may be unavailable on file origins, so the range is displayed for manual copy.

The offline package is intentionally unauthenticated and read-only in its interface. It is not DRM or tamper-proof. Its files can be edited externally. Corporate browser policy may force PDF downloads or disable embedded previews; the fallback handles this without a local server.

## Deliberate exclusions and limits

No iManage integration is implemented. Source-provider IDs, external matter IDs, and `DocumentStorage` keep that future integration possible. No AI/OCR, email processing, privilege logs, redaction, annotations, review assignments, or external-user sharing is included. Complex signed PDFs, portfolios, unusual forms/annotations, and damaged content can require manual handling; `pdf-lib` rewriting does not preserve a digital signature's validity. Visual review of final outputs remains part of the workflow.

## Progress and indexed export

Bates POST accepts application/x-ndjson and streams real engine progress plus file-save stages. Complete is emitted only after the database transaction commits; errors are emitted in the stream. JSON clients retain the existing behavior. A heartbeat keeps idle connections active, but this is not a durable background job or cancellation API. After a lost connection, reload the production before retrying.

Index & Tags combines metadata editing, selection, tag filtering and bulk tagging. Manage tags handles production-local tag definitions; the old Tags route opens Index & Tags.

Indexed PDF export copies processed pages with pdf-lib, adds linked index pages and outlines, and embeds the bundled Liberation Sans font. Return links use a new 24-point visual-bottom strip outside each original CropBox, honoring rotations and nonzero origins. Index entries target document first pages; return links target the relevant index page. Existing content coordinates and Bates values remain unchanged. Long tag listings show an explicit omission note after two lines to keep index entries usable. Originals and existing processed PDFs remain unchanged. Export validation, revision locking, immutable snapshot history, authenticated download and deletion cleanup use the existing pipeline. Existing upload and processing limits remain unchanged.
