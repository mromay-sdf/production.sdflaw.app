# Entra sign-in before the application loads

The application now uses Azure App Service Authentication (Easy Auth), rather than browser MSAL access tokens. Azure authenticates the visitor before forwarding page, asset, and API requests. The server independently verifies the injected signed Entra ID token against the configured tenant and identity-provider client ID. Unsigned principal headers and the former Authorization bearer flow are not accepted.

## Required Azure setup

On the existing `sdf-production` App Service, open Authentication and add Microsoft:

- Workforce, SDF tenant `9b0c1562-91c1-4218-ab50-19ef2abae3bb`.
- Reuse `sdf-production-web`, client ID `b98d936d-5c2b-4611-a3ca-135428502554`.
- Issuer `https://login.microsoftonline.com/9b0c1562-91c1-4218-ab50-19ef2abae3bb/v2.0`.
- Require authentication; unauthenticated requests redirect with HTTP 302 to Microsoft.
- Allow only this client application and only the issuer tenant.
- Enable token store so Azure supplies `X-MS-TOKEN-AAD-ID-TOKEN`.
- Azure generates a server credential for the selected registration; store it only in App Service settings. Track its selected expiration and rotate before expiry.
- Confirm Web callback URLs for both `https://production.sdflaw.app/.auth/login/aad/callback` and `https://sdf-production-djcnajejfahngjas.centralus-01.azurewebsites.net/.auth/login/aad/callback`.
- Retain enterprise application's assignment requirement and existing assigned users. Additional employees require deliberate assignment; tenant guests are not automatically employees. No Graph data permission is needed by this application.

Keep `ENTRA_TENANT_ID` and `ENTRA_CLIENT_ID` above. `ENTRA_AUDIENCE` and `ENTRA_SCOPE` are obsolete for the new server. The browser no longer receives tenant/client/scope configuration or stores Microsoft tokens. Easy Auth owns session cookies, login, and logout. Every state-changing API request still requires the exact configured Origin to protect cookie sessions against cross-site requests.

The app protects all routes before static files, including `/api/config`. `/healthz` is the sole application-level anonymous exception and contains only liveness status; Azure can still gate it when no excluded path is configured. Direct access to the server must not bypass App Service. Production still forbids development identity and requires HTTPS and durable storage unless explicit disposable Azure testing mode is enabled.

## Deployment and acceptance

Configure the Azure provider and deploy the changed application as a coordinated migration. Enabling the provider while the old app runs can produce a second login inside the page until the new build is deployed. Use the existing GitHub Actions deployment. No new hosting resources or SKU upgrade are required.

1. Anonymous requests to `/`, a published viewer, a JS asset, and `/api/config` must redirect to Microsoft without returning application content. Verify both the custom domain and default Azure hostname.
2. Sign in as an existing assigned SDF user. Confirm the Productions page opens without an in-page sign-in prompt or browser bearer-token acquisition.
3. Confirm other-tenant and unassigned users are rejected. Confirm cross-origin mutations fail.
4. Exercise sign-out and an expired session, then sign back in. Authentication expiry must navigate to Microsoft instead of parsing its HTML as API JSON.
5. Upload a synthetic PDF and verify Bates, viewer, and exports.

Offline ZIP packages remain downloaded files without online authentication. Previously downloaded copies cannot be recalled.

## Verification and status

Local automated authentication tests cover anonymous pages/assets/configuration, forged principal headers, the obsolete bearer flow, valid signed ID tokens, wrong tenant/audience, expiry, invalid signatures, and cross-origin writes. Live Azure configuration and end-to-end sign-in require portal acceptance; prepared local code alone does not establish deployment.

References: https://learn.microsoft.com/en-us/azure/app-service/overview-authentication-authorization and https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-oauth-tokens
