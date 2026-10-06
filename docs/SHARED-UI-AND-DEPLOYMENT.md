# Shared UI and deployment

Application repository: https://github.com/mromay-sdf/production.sdflaw.app

Design source: https://github.com/mromay-sdf/SDF-UI

SDF-UI currently provides a showcase application rather than a published component package. Production consumes its raw palette, light/dark semantic tokens, and PNG logos through a committed snapshot in `vendor/sdf-ui`. `sdf-ui.lock.json` records the exact upstream commit. The adapter generates `public/sdf-ui/sdf-tokens.css` and logo assets for the web app, offline viewer, and PDF reports. Production's workflow components, resizable viewer, local fonts, and accessibility behavior stay in this repository. Tailwind and Google Fonts from the showcase are not required at runtime.

Run `pnpm ui:sync` to restore the pinned revision, or `pnpm ui:sync main` to explicitly pull the current upstream main branch. This requires Git access to SDF-UI. Review the resulting snapshot and lockfile changes, run the build and tests, and commit them together. Builds use the checked-in snapshot, with no cross-repository credential or runtime GitHub dependency.

## Azure deployment

The manual **Build and deploy SDF Production** Actions workflow runs the build and tests and produces a downloadable ZIP. It only deploys when its `deploy` checkbox is selected. Add the existing App Service publish profile as the repository Actions secret `AZURE_WEBAPP_PUBLISH_PROFILE` before selecting that option. Never commit the profile. The workflow targets the existing Linux Node 24 `sdf-production` App Service and starts `sh /home/site/wwwroot/azure-start.sh`.

The workflow installs production dependencies on Linux and includes them in the deployment ZIP. Its startup script starts Node directly, avoiding the slow npm installation on each Azure cold start. The local manually packaged ZIP still uses the fallback installation script documented in `DEPLOY-AZURE-CODE.md`.

The Azure app's current Entra and test-mode settings must remain configured. This repository name does not configure DNS or change the app origin to production.sdflaw.app; a custom domain requires separate DNS, TLS, and Entra redirect configuration.

No new Azure resource or hosting tier is provisioned by this workflow. Running it consumes GitHub Actions runner minutes and temporary artifact storage under the repository owner's plan; charges depend on available allowance and billing settings. It is manual so pushing source does not start a billable workflow or change the live app. Existing Azure hosting charges continue.
