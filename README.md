> Authentication migration: current code uses App Service Entra authentication before page load. Follow [Entra gate setup](docs/ENTRA-GATE.md) for current settings; older SPA/API sign-in instructions below are historical.

# SDF Production

Source and deployment: [production.sdflaw.app](https://github.com/mromay-sdf/production.sdflaw.app). Shared design tokens and logos are synchronized from [SDF-UI](https://github.com/mromay-sdf/SDF-UI); see [UI updates and deployment](docs/SHARED-UI-AND-DEPLOYMENT.md).

Persistent internal document-production application built for Azure App Service. Includes source PDF uploads, the existing SDF Bates engine, editable index, tags, validation, a two-pane attorney viewer, immutable internal publication, Excel indexes, and self-contained offline ZIP packages.

## Local development

Requires Node.js 24 and pnpm 11.19.0.

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
pnpm dev:local
```

Open http://127.0.0.1:4180. Local development binds to loopback and uses an explicitly labeled development identity. Records live in `data/production.sqlite`; originals, outputs, and export artifacts live in `data/blobs`. Neither is publicly served. Restarting preserves productions. The directory is ignored by Git and Docker. Browser storage holds theme/viewer-width preferences and MSAL session tokens only.

Without `DEV_AUTH=true`, all data APIs require Entra. Production refuses startup with development auth, local storage, or missing cloud/Entra configuration. Do not use the development identity for confidential work.

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
```

Browser tests use installed Edge on Windows. On Linux, first install Playwright Chromium (`pnpm exec playwright install --with-deps chromium`). Tests create synthetic documents in temporary directories and remove them afterward. Screenshots are in `test-results`.

## Production workflow

1. Create a production with a name and matter/client.
2. Add PDFs. Review page counts, duplicate-name notices, and protected/unreadable status. Reorder/remove as needed.
3. Apply Bates settings. A modal reports actual page progress, current file, and saved documents, then offers Continue to Index & Tags after the production is saved. Separate PDFs are always generated; combined PDF is optional.
4. Edit metadata and bulk-apply/remove tags in the combined Index & Tags table. Generated ranges remain read-only. Use Manage tags to create, rename, or delete production tags.
5. Run validation. Errors block publication and exports; duplicate original names are warnings because output names are unique.
6. Publish the internal viewer. `/p/{uuid}` always requires authentication for production data and PDFs. Workspace changes do not alter an existing published snapshot. Republish deliberately to update it.
7. Generate an offline ZIP or Excel index and download it from export history. Every export records its author, time, revision, and immutable snapshot.

Adding, removing, or reordering source PDFs invalidates workspace Bates outputs and validation. Previously published/exported snapshots remain intact. Unpublish removes access through the internal published endpoint; already downloaded files cannot be recalled.

Viewer layouts use the remaining window height with independently scrolling panes. Drag the divider (or focus it and use arrow keys) to resize; double-click resets the split. The index can be hidden and restored. Width preference is stored locally when browser settings permit. The internal renderer defaults to Fit page and also supports Fit width and zoom. Offline packages include the compact header, resizable panes, index toggle, and native PDF fit requests; native fit behavior depends on browser support. Generate a new offline package to obtain updated viewer assets—existing export snapshots remain unchanged.

Delete a production from its row in the Productions list, or from Documents → Production details. Type its exact name to confirm. Deletion removes the database record, saved snapshots, and membership records and immediately disables its internal viewer/file/export URLs. Referenced source PDFs, processed PDFs, and export artifacts are queued for deletion in private storage, with retries after temporary storage failures. Downloaded copies cannot be recalled. The SDF logo returns to Productions from both the workspace and the viewer.

## Structure

| Path | Responsibility |
| --- | --- |
| `src` | React workspace, Entra client, PDF.js viewer, SDF styling |
| `server` | Authenticated API, transactions, storage, validation, exports |
| `shared/model.ts` | Production, documents, tags, snapshots, validation types |
| `shared/sdf-pdf` | Vendored existing SDF PDF Bates engine and tests |
| `offline` | Plain-script `file://` viewer, no runtime dependencies |
| `public/sdf-ui` | Supplied SDF UI assets plus self-hosted Source Sans 3 |
| `docs/ARCHITECTURE.md` | Initial review, decisions, data model, routes, limits |
| `docs/DEPLOYMENT.md` | Entra, PostgreSQL, Azure Blob, App Service configuration |
| `SECURITY.md` | Security boundaries and operational requirements |

## Deployment status

Local implementation and automated workflow verification are complete. **No Azure resources, Entra registrations, DNS records, or public deployment have been created.** PostgreSQL and Azure Blob adapters are implemented but require testing against SDF's configured services before production use. The Dockerfile is provided; Docker is unavailable on the development host, so its image has not been built here.

See [deployment](docs/DEPLOYMENT.md) for the specific remaining environment setup. Version 0.1 processes bounded productions in the application process; it is not a resumable background job system. Limits: 50 MB per PDF, 500 PDFs, 256 MB total source bytes, and 10,000 pages. Benchmark real workloads in staging before increasing these limits.

## Indexed PDF export

In Publish & export, choose Generate indexed PDF, then download it from export history. This creates one PDF containing a clickable front index, document bookmarks, and a Return to index link on every document page. Tags are optional. Existing Bates labels are preserved; index pages are not Bates numbered. Each document page gains a 24-point navigation strip outside its original visible area, slightly changing page size without covering content. The return link opens the index page containing that document. Exports are saved snapshots; generate a new export to include later edits.


For a local preview of the built UI, run `pnpm build` followed by `pnpm preview:local`. This keeps the same local identity and data but avoids the Vite development watcher. Rebuild and restart this preview after code changes.


New indexed PDF exports use the SDF expense-report-style logo header on index pages. Newly generated offline ZIPs include a matching one-page Start Here.pdf instead of a text README. Previously saved exports remain unchanged; generate a new export to receive these updates.
