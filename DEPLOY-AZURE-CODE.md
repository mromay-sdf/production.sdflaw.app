# SDF Production — Azure Code ZIP deployment

Use `outputs/SDF-Production-Azure-Code.zip` for the Linux Node.js App Service. This contains the compiled frontend/server, required assets, and an npm lockfile. No Docker build is needed. Upload the ZIP itself, without extracting or adding a parent folder.

## Azure configuration applied

- App: `sdf-production`, resource group: `vibe-webapps-rg`
- Runtime: Node.js 24 LTS (Linux Code)
- Startup command for this updated ZIP: `sh /home/site/wwwroot/azure-start.sh`. Azure currently uses the equivalent inline command because the previously deployed ZIP lacks this script.
- `SCM_DO_BUILD_DURING_DEPLOYMENT=true` is configured, but the portal's Publish files QuickDeploy flow skipped the build on September 30, 2026. Do not assume that setting alone installs dependencies. The startup script copies the package manifests and compiled server to `/tmp/sdf-production-runtime`, installs locked dependencies there, and launches that server with `/home/site/wwwroot` as its working directory for assets. This avoids installing thousands of files on the slower shared `/home` mount. Startup still requires npm registry availability.
- `NODE_ENV=production`, `AZURE_TEST_MODE=true`, `DEV_AUTH=false`
- `WEBSITES_CONTAINER_START_TIME_LIMIT=600` allows the first runtime dependency installation to finish; the original 230-second allowance interrupted package downloads.
- `DATA_DIR=/tmp/sdf-production-test`
- `APP_ORIGIN=https://sdf-production-djcnajejfahngjas.centralus-01.azurewebsites.net`
- `ENTRA_TENANT_ID=9b0c1562-91c1-4218-ab50-19ef2abae3bb`

## Sign-in configuration applied September 30, 2026

The following single-tenant registrations were created with the user's approval at $0 additional registration/licensing cost:

- Browser: `sdf-production-web`, client ID `b98d936d-5c2b-4611-a3ca-135428502554`.
- API: `sdf-production-api`, audience `a0bb0535-628d-4236-960f-08139fa097e6`.
- Scope: `api://a0bb0535-628d-4236-960f-08139fa097e6/access_as_user`.
- Both enterprise applications require assignment; initial assignment and delegated consent are restricted to `mromayADM@sdflawoffice.onmicrosoft.com`.
- These three environment variables were set on the App Service. No Microsoft Graph data permissions or client secrets were added.
- Live Microsoft sign-in was verified in Edge on September 30, 2026 as MarioRomay ADM; the authenticated Productions screen loaded successfully. `/healthz` returned HTTP 200 and `{"status":"ok"}`; anonymous `/api/productions` returned HTTP 401. The five local Azure runtime configuration tests passed. PDF upload and export workflows were not exercised against this deployment during the startup repair.

Before future Azure changes, state the expected additional cost, including $0 when applicable, and obtain approval for any chargeable changes.

## Requirements for a new deployment

Complete the SDF Entra application registration and set these App Service environment variables:

| Variable | Value |
| --- | --- |
| `ENTRA_CLIENT_ID` | Browser SPA application/client UUID |
| `ENTRA_AUDIENCE` | API application/client UUID |
| `ENTRA_SCOPE` | `api://API_CLIENT_ID/access_as_user` |

Use single-tenant registrations. Configure the SPA redirect URI as `https://sdf-production-djcnajejfahngjas.centralus-01.azurewebsites.net`. Expose the API delegated `access_as_user` scope, use v2 access tokens, and grant the SPA that delegated permission with the firm's approved consent. Restrict enterprise application assignments to intended SDF testers. No client secret is required by this app.

The server intentionally refuses startup with missing Entra settings. The ZIP does not include credentials or placeholder authentication settings. Initial access is limited to the assigned admin account; other testers must be explicitly assigned before they can sign in.

## Upload

In App Service → Deployment Center, select **Manual Deployment (Push)** → **Publish files (new)**, choose this ZIP, and deploy. Keep the dependency-install startup command above when using this upload flow. Verify startup logs show dependency installation completing. Do not enable `WEBSITE_RUN_FROM_PACKAGE` with this writable-directory fallback. A future deployment pipeline should install dependencies during deployment and restore the simpler `node dist-server/index.js` startup command.

After Entra configuration and deployment, verify `/healthz`, SDF sign-in, a synthetic PDF upload, Bates labeling, validation, and both exports. An unauthenticated request to `/api/productions` must return 401.

## Testing limitations

This configuration uses server-local disposable SQLite and PDF storage, without Blob Storage or PostgreSQL. PDF processing occurs on the Azure server; it is not browser-only processing. Data can disappear on restart, redeployment, or host replacement. Keep one instance and use synthetic test documents. Cold starts currently take several minutes because dependencies are installed at startup. The existing upload limits are unchanged. Durable production storage requires the separate PostgreSQL/Blob configuration described in `docs/DEPLOYMENT.md` in the source project.

Reference: https://learn.microsoft.com/en-us/azure/app-service/deploy-zip
