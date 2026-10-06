# Deploy SDF Production for limited testing

This ZIP is a **container build package**, not a Kudu ZIP-deploy package. The existing sdf-production App Service uses a Linux container with sidecar support. Do not upload this ZIP to the current static placeholder and expect Node.js to run.

## Target

- Subscription: SDF Security
- Resource group: vibe-webapps-rg
- App: sdf-production
- Existing plan: vibe-webapps-plan (B1), Central US
- URL: https://sdf-production-djcnajejfahngjas.centralus-01.azurewebsites.net
- Existing registry: sdfappsacr (verify access before building)

## 1. Configure SDF sign-in

Follow docs/DEPLOYMENT.md, section 1, to register the SPA and API in Entra. Use the URL above as the SPA redirect URI. Expose access_as_user and use v2 API tokens. Require assignment and assign only the intended SDF testers. The application validates bearer tokens itself; enabling App Service Authentication alone does not configure this app. No client secret is needed by the browser.

## 2. Build the image

Upload the ZIP to Azure Cloud Shell (Bash), extract it into a new directory, then change into that directory. Dockerfile and package.json must be at its root. Cloud Shell's upload storage is only for the build package; production documents will not use it.

```bash
az account set --subscription b63bd0bb-7c65-4c4b-ae23-9537c3cad493
az acr build --registry sdfappsacr --image sdf-production:test-v1 --file Dockerfile .
```

The image build installs Linux dependencies and rebuilds the frontend and server. Do not copy Windows node_modules into the image. Registry builds may incur charges and depend on your registry's Tasks permissions/configuration. If remote builds are unavailable, build and push the same Dockerfile with Docker on a suitable workstation or CI runner.

## 3. App settings

In sdf-production > Settings > Environment variables, add:

| Setting | Value |
|---|---|
| NODE_ENV | production |
| AZURE_TEST_MODE | true |
| DEV_AUTH | false |
| PORT | 8080 |
| DATA_DIR | /tmp/sdf-production-test |
| APP_ORIGIN | https://sdf-production-djcnajejfahngjas.centralus-01.azurewebsites.net |
| ENTRA_TENANT_ID | 9b0c1562-91c1-4218-ab50-19ef2abae3bb |
| ENTRA_CLIENT_ID | Your SPA application/client ID |
| ENTRA_AUDIENCE | Your API application/client ID |
| ENTRA_SCOPE | api://YOUR_API_CLIENT_ID/access_as_user |

Leave DATABASE_URL and AZURE_STORAGE_ACCOUNT_URL unset. Keep one app instance. Do not scale or change the shared plan for this test. Use small synthetic samples: the B1 plan shares its memory/CPU with your other apps. Existing file/page limits remain unchanged.

## 4. Select the image

In sdf-production > Identity, enable its system-assigned identity. Give that identity the appropriate image-pull role on sdfappsacr (AcrPull for a registry using traditional RBAC; use the matching repository-reader role if your registry uses ABAC). These are administrator permission changes; use your normal approval process.

In Deployment Center, edit the main container to use the sdfappsacr registry, image sdf-production, tag test-v1, target port **8080**, and managed identity authentication. Keep it as the main container. Save and restart. Sidecar-enabled apps use the container target-port setting; do not rely on WEBSITES_PORT alone. Confirm HTTPS Only is enabled. No database or Blob account is required in this explicit testing mode.

## 5. Check before sharing

1. /healthz returns {"status":"ok"}; this is liveness only.
2. /api/config shows dev:false and testing:true. The app displays the test-environment banner after sign-in.
3. /api/productions returns 401 without a token. Confirm assigned tester sign-in succeeds and an unassigned account cannot use the app.
4. Upload synthetic PDFs, run Bates, edit Index & Tags, validate, preview, generate the branded indexed PDF and offline ZIP, and download them.
5. Only then distribute the app URL to testers.

Files are processed on Azure, not in the user's browser. SQLite, PDFs and exports are on disposable container storage; saved work and viewer links may disappear on replacement/redeployment. Download anything needed before restarting or deploying again. This is a shared test workspace, not per-matter access control. Do not use client records.

## Package status

Local TypeScript, automated workflow tests, and frontend/server builds were checked. Docker/ACR build, Entra sign-in and live Azure deployment have not been verified. This package contains no credentials, local database, uploaded PDFs, node_modules or real production records. The included dist folders are reference builds; Docker rebuilds from source.

References: https://learn.microsoft.com/en-us/azure/container-registry/container-registry-tutorial-quick-task and https://learn.microsoft.com/en-us/azure/app-service/configure-sidecar and https://learn.microsoft.com/en-us/azure/app-service/deploy-zip
