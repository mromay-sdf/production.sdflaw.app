# Local verification — September 29, 2026

Verified with Node 24.19.0 and installed Microsoft Edge on Windows.

- TypeScript strict type checking passes.
- Vite production client and esbuild server bundles build successfully.
- 32 Vitest checks pass: 20 inherited Bates/coordinate/merge checks and 12 persistent workflow/auth-boundary checks.
- Playwright browser workflow passes: create, multi-upload, Bates, index edit, tag creation/bulk apply, validation, PDF.js preview and page navigation, Bates-range search, themes, publication, offline export, published reload, and responsive layout.
- Offline extracted package tested from `file://`; metadata/search/tags and relative PDF links function without HTTP requests. Direct PDF fallback remains available; native PDF plug-ins may not render in headless or policy-restricted browsers.
- Generated Excel files reopened with ExcelJS; expected Bates cells, rows, and three-column export verified.
- Source PDFs compared byte-for-byte after labeling; unchanged. Processed output differs and matches expected page counts and sequences.
- All ten vendored source/test files match both recorded SHA-256 hashes and `../PDF/src`.
- Screenshots visually inspected for document table, viewer, dark theme, tablet layout, offline layout, and Bates placement. The rendered second page visibly contains `SDF_000002` at the lower-right margin. Initial native-preview limitations prompted the bundled PDF.js implementation.

Synthetic documents were used. No client records or real productions were added. Automated test records were isolated in temporary databases/storage and removed afterward. The interactive local workspace starts empty.

Not verified in this environment: real SDF Entra login/group assignments, PostgreSQL service/row-lock integration, Azure Blob managed identity, Docker image build (Docker unavailable), App Service deployment, production domain/TLS, live service failover/restore, and representative large-workload performance. See DEPLOYMENT.md for acceptance steps. Do not treat a successful local test as proof of those external integrations.

## Compact/resizable viewer follow-up

The workspace and published viewers now use compact headers and viewport-filling panes. Browser checks cover pointer dragging, keyboard adjustment, index collapse/restore, saved width across reload, and PDF.js Fit page/Fit width. The same resizing and compact layout were verified in a newly generated offline package opened from file://, without HTTP requests. Offline native fit requests are verified as PDF URL fragments; their visual interpretation remains browser-dependent. At a 1440 × 1000 test viewport, the published viewer begins around 143 pixels from the top and extends to the bottom gutter. Existing ZIP snapshots are preserved; generate a new ZIP for the updated viewer assets.

Strict TypeScript, production frontend build, all 32 unit/integration checks, and the expanded browser workflow passed after these changes.

## Production deletion and logo navigation

Strict TypeScript, frontend/server builds, all 33 unit/integration tests, and the expanded browser workflow pass. Tests verify exact-name confirmation, cancellation, stale-revision rejection, published/file/export URL revocation, snapshot/membership removal, isolation from other productions, persisted cleanup retries after reopening the database, and removal of referenced files. Browser tests also verify both sidebar and viewer-header logo navigation back to Productions. Only isolated synthetic test productions were deleted.

## Bates progress, Index & Tags, and indexed PDF

Strict TypeScript, frontend/server builds, 36 unit/integration tests and the complete browser workflow passed. New checks verify streamed progress and committed completion, stale-revision errors, indexed export history and PDF downloads, multi-page index destinations, document bookmarks, and return-link rectangles outside original page content at 0/90/180/270 degrees with nonzero CropBox origins. Browser checks cover the completion dialog, combined metadata/tag workflow, and indexed export generation. A synthetic 24-document PDF was rendered with PDF.js; its index and all four page orientations were visually inspected. No real production data was changed. Large-workload and cloud/proxy streaming acceptance remain unverified.


## Branded export headers and offline PDF guide

The indexed PDF and offline Start Here.pdf share the Expense application current PDF header: 82-point navy band, white stacked SDF logo, and right-aligned report details. Full production and matter names wrap below the header. The ZIP now includes Production/Start Here.pdf instead of README.txt. Unit/integration checks verify the guide is a single PDF page, logos are embedded, and existing index/return destinations remain correct. Synthetic normal and maximum-length metadata guides and the new index were rendered and visually inspected. The supplied Downloads reference was unavailable; styling was taken from the sibling Expense application source and its existing logo asset.
