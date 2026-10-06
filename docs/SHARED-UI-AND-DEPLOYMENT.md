# Shared UI and deployment

Application repository: https://github.com/mromay-sdf/production.sdflaw.app

Design source: https://github.com/mromay-sdf/SDF-UI

SDF-UI currently provides a showcase application rather than a published component package. Production consumes its raw palette, light/dark semantic tokens, and PNG logos through a committed snapshot in `vendor/sdf-ui`. `sdf-ui.lock.json` records the exact upstream commit. The adapter generates `public/sdf-ui/sdf-tokens.css` and logo assets for the web app, offline viewer, and PDF reports. Production's workflow components, resizable viewer, local fonts, and accessibility behavior stay in this repository. Tailwind and Google Fonts from the showcase are not required at runtime.

Run `pnpm ui:sync` to restore the pinned revision, or `pnpm ui:sync main` to explicitly pull the current upstream main branch. This requires Git access to SDF-UI. Review the resulting snapshot and lockfile changes, run the build and tests, and commit them together. Builds use the checked-in snapshot, with no cross-repository credential or runtime GitHub dependency.

## Azure deployment

The **Deploy SDF Production** workflow runs on every push to `main`, with a manual run option. It builds and tests the app before deploying to the existing `sdf-production` Linux Node 24 App Service. Authentication uses Azure Deployment Center's existing federated managed identity and its three `AZUREAPPSERVICE_*` repository secrets; no publish profile is needed. That identity requires Website Contributor scoped to this App Service. The app starts with `sh /home/site/wwwroot/azure-start.sh`.

The workflow installs production dependencies on Linux and includes them in the deployment ZIP. Its startup script starts Node directly, avoiding the slow npm installation on each Azure cold start. The local manually packaged ZIP still uses the fallback installation script documented in `DEPLOY-AZURE-CODE.md`.

The Azure app's current Entra and test-mode settings must remain configured. This repository name does not configure DNS or change the app origin to production.sdflaw.app; a custom domain requires separate DNS, TLS, and Entra redirect configuration.

No new Azure resource or hosting tier is provisioned by this workflow. Running it consumes GitHub Actions runner minutes and temporary artifact storage under the repository owner's plan; charges depend on available allowance and billing settings. Every push to main starts a build and, if checks pass, deploys the live app. Existing Azure hosting charges continue.
