# Deploy to production.sdflaw.app

No production deployment was performed by this implementation. Configure a staging environment first, then run the acceptance checks below with synthetic records.

## 1. Entra applications

Use single-tenant applications in the SDF tenant. Register a browser SPA and an API (or deliberately configure one registration for both).

API: expose `api://API_CLIENT_ID/access_as_user` as an admin-consented delegated scope. Set `api.requestedAccessTokenVersion` to `2` in the manifest. Grant the SPA the delegated API permission and tenant admin consent. Use the API's application/client UUID as `ENTRA_AUDIENCE` for v2 tokens.

SPA: add `https://production.sdflaw.app` as a **Single-page application** redirect URI. Add a separate staging URI for staging. Do not use a client secret in the SPA. The API also checks that the token's `azp` matches the configured SPA client.

Require assignment on the relevant enterprise applications and assign the SDF employee security group. Exclude guest/external users from that group. Apply the firm's MFA/Conditional Access policy. Tenant-only validation alone does not distinguish employees from tenant guests.

Microsoft documents API-side access-token validation, audience/issuer checks, and the token-version setting in [Access tokens in the Microsoft identity platform](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens).

## 2. Durable services

- Provision Azure Database for PostgreSQL Flexible Server. Create a dedicated database and application role with access only to this database/schema. Enable TLS verification (`sslmode=verify-full`); use the approved trust chain. Store `DATABASE_URL` in Key Vault and reference it from App Service settings. Configure network access from App Service via the firm's network policy. First startup creates the three initial schema tables.
- Provision an Azure Storage account and a **private** blob container, e.g. `production-private`. Disable anonymous blob access at account level and set container public access to None. Enable encryption, approved soft-delete/version retention, and backup/recovery policies. No public SAS links are generated.
- Enable App Service managed identity. Assign that identity Storage Blob Data Contributor scoped to the container. The application uses `DefaultAzureCredential`; no storage account key belongs in frontend settings. See [Microsoft Entra authorization for blobs](https://learn.microsoft.com/en-us/azure/storage/blobs/authorize-access-azure-active-directory).
- Configure coordinated PostgreSQL and Blob backup/restore. A database backup without the referenced PDFs/export blobs is insufficient. Run a restore drill before confidential use.

## 3. Build and run the container

From this repository:

```sh
docker build -t YOUR_REGISTRY/sdf-production:0.1.0 .
docker push YOUR_REGISTRY/sdf-production:0.1.0
```

Use an Azure App Service Linux custom container with an appropriate memory tier and registry access. The image runs Node 24 as an unprivileged user. App Service must route to container port 8080 (set `WEBSITES_PORT=8080` where required by the selected container configuration). Enable Always On, HTTPS Only, supported TLS settings, and managed certificate/custom hostname configuration. Bind `production.sdflaw.app` only after DNS ownership verification. No DNS or subscription details are assumed here.

App settings:

| Setting | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DEV_AUTH` | `false` (or omit) |
| `PORT` | `8080` |
| `APP_ORIGIN` | `https://production.sdflaw.app` |
| `ENTRA_TENANT_ID` | SDF tenant UUID |
| `ENTRA_CLIENT_ID` | SPA client UUID |
| `ENTRA_AUDIENCE` | API client UUID |
| `ENTRA_SCOPE` | `api://API_CLIENT_ID/access_as_user` |
| `DATABASE_URL` | TLS-verified PostgreSQL URL via Key Vault |
| `AZURE_STORAGE_ACCOUNT_URL` | `https://ACCOUNT.blob.core.windows.net` |
| `AZURE_STORAGE_CONTAINER` | `production-private` |

The server refuses production startup if required settings are missing or development auth is enabled. It does not use App Service Easy Auth headers; auth is enforced directly by the API. `/healthz` returns a non-confidential liveness response, not a database/blob readiness check.

## 4. Staging acceptance

1. Confirm the image starts and the health endpoint responds. Check static JS/worker MIME types and local font assets.
2. With no token, verify `/api/productions`, published data, PDFs, and exports return 401. With wrong tenant/audience/client or missing scope, verify rejection. Try an unassigned/guest user as well as an assigned SDF user. Validate successful interactive login, refresh, and logout.
3. Upload synthetic PDFs, label, tag, edit, validate, publish, and export. Confirm objects live in the private container and anonymous requests cannot retrieve them. Confirm no source names or metadata appear in URL logs.
4. Restart App Service and confirm records/files persist. Use two browser sessions to verify 409 stale-edit handling. If scaling to multiple instances, repeat mutation races against PostgreSQL.
5. Confirm published snapshots remain unchanged after workspace edits. Unpublish and verify new published fetches fail.
6. Extract an offline ZIP and disconnect networking. Test Edge and Chrome under actual firm policies. Check direct Open PDF fallback and the Excel workbook.
7. Review rotation/crop placement, page count, Bates continuity, file order, images, forms/annotations, and output quality against representative real-format synthetic samples. Benchmark memory/time against anticipated production sizes.
8. Exercise database/blob outage and backup/restore procedures. Monitor errors without logging document bytes, request bodies, Authorization headers, or confidential metadata.

Cloud-adapter integration, tenant sign-in, container build, DNS/TLS, and real workload benchmarking remain environment-dependent acceptance work. This repository does not claim those checks have run.
