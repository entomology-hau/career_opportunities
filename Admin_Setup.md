# Set up the admin login

Prepared for `entomology-hau/career_opportunities`, 1 October 2026. This is setup guidance for the supplied code; the GitHub App and Cloudflare Worker have not been registered, deployed or tested against your accounts.

The public board stays on GitHub Pages. Its **Admin** page sends you to a small Cloudflare Worker to sign in with GitHub and handle uncertain listings. The Worker hosts the admin interface and its API together, so the login does not depend on third-party cookies. Admin changes are committed to `data/review-queue.json`; the existing Pages workflow then applies the decisions and republishes the board. The queue and audit are still stored in a public repository; sign-in restricts actions rather than making that metadata private.

You need access to the repository owner's GitHub settings, a Cloudflare account, and a current Node.js LTS installation with npm. Use the supplied project files together: `admin-backend` needs its neighbouring `site` folder when deployed.

## 1. Create the Worker and obtain its address

Open `admin-backend/wrangler.jsonc`. Choose a Worker `name`, for example `hau-opportunities-admin`, and check its non-secret variables:

| Variable | Value |
| --- | --- |
| `REPOSITORY` | `entomology-hau/career_opportunities` |
| `BRANCH` | `main` |
| `ALLOWED_GITHUB_LOGINS` | The exact GitHub username that will sign in; initially `entomology-hau` |
| `PUBLIC_SITE_URL` | `https://entomology-hau.github.io/career_opportunities/` |
| `GITHUB_CLIENT_ID` | Leave blank for this first deployment; fill it after step 2 |

If `entomology-hau` is an organisation, it cannot sign in: use your individual GitHub username, which must have write access to this repository. For multiple administrators, use a comma-separated list of their exact usernames. An allowlisted username alone does not grant repository access.

Keep `assets.directory` as `../site`, its binding as `ASSETS`, `html_handling` as `none`, and `run_worker_first` as `true`. These settings let the Worker control its authentication and API routes before serving files.

In a terminal, change into the extracted project's `admin-backend` folder, then run:

```sh
npx wrangler@4 login
npx wrangler@4 deploy
```

Follow Cloudflare's sign-in prompts. If requested, choose your account and `workers.dev` subdomain. Copy the deployed HTTPS origin, such as `https://hau-opportunities-admin.your-subdomain.workers.dev`, without a trailing slash. Use this exact origin below. The initial deployment serves the interface, but sign-in and API access remain unavailable until the credentials are configured.

## 2. Register a GitHub App

In GitHub, open the repository owner's **Settings → Developer settings → GitHub Apps → New GitHub App**. For an organisation-owned app, use that organisation's settings. Register a **GitHub App**, rather than an OAuth App or personal access token.

Set:

| Setting | Value |
| --- | --- |
| App name | A unique name such as `HAU Opportunities Admin` |
| Homepage URL | `https://entomology-hau.github.io/career_opportunities/` |
| Callback URL | Your Worker origin followed by `/auth/callback` |
| Expiring user authorisation tokens | Keep enabled |
| Request user authorisation during installation | Leave unchecked; the admin page starts sign-in separately |
| Device flow | Leave disabled |
| Webhook: Active | Uncheck; this app does not use webhooks |
| Repository permissions: Contents | **Read and write** |
| Repository permissions: Metadata | Read-only, included automatically |
| Other repository, organisation and account permissions | No additional permissions |
| Where can this GitHub App be installed? | **Only on this account** |

The callback must match exactly. Do not add a wildcard, query string or the GitHub Pages project path to it. For example, use `https://hau-opportunities-admin.your-subdomain.workers.dev/auth/callback`.

GitHub's Contents permission applies to the selected repository; the Worker limits its write endpoint to queue decisions in `data/review-queue.json`.

Create the app. Copy its **Client ID** into `GITHUB_CLIENT_ID` in `wrangler.jsonc`; the numeric App ID is a different value. This design does not need an App private key.

On the app's settings page, choose **Install App**, select the repository owner, choose **Only select repositories**, and select only **career_opportunities**. Installation and user sign-in are separate steps; both are needed. The app should not be installed across all repositories.

## 3. Add the two Worker secrets

On the GitHub App's settings page, generate a client secret. Enter it directly into the prompt from this command, run inside `admin-backend`:

```sh
npx wrangler@4 secret put GITHUB_CLIENT_SECRET
```

Create the session encryption secret as 32 random bytes represented by 64 hexadecimal characters. This command generates it and pipes it straight to Wrangler, without creating a file or putting its value in terminal history:

```sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))" | npx wrangler@4 secret put SESSION_SECRET
```

Alternatively, use **Cloudflare → Workers & Pages → your Worker → Settings → Variables and Secrets → Add**, select **Secret**, enter each name and value, then deploy the change. Store `GITHUB_CLIENT_SECRET` and `SESSION_SECRET` only as Worker secrets. Do not put their values into `wrangler.jsonc`, GitHub Pages files, a commit or chat.

Deploy again to apply the completed non-secret configuration and supplied code:

```sh
npx wrangler@4 deploy
```

Keep the same Worker name and origin. If either changes, update the GitHub App callback and the setting in the next step as well.

## 4. Connect the public site's Admin link

Edit `site/admin-config.json` so `apiBase` is your full Worker origin:

```json
{
  "apiBase": "https://hau-opportunities-admin.your-subdomain.workers.dev"
}
```

This address is public and contains no credential. Commit it along with the supplied site, scripts and other project updates to `main`, following `GitHub_Update_Instructions.md`. Keep the existing Pages publishing workflow enabled. GitHub Pages hosts the public board; the Worker serves its own admin configuration for same-origin API calls after sign-in.

Changes to the Worker or the admin interface also need a new `npx wrangler@4 deploy` from `admin-backend`. A GitHub Pages deployment alone does not update the Worker copy of those files.

## 5. Verify sign-in and a decision

1. Open `https://entomology-hau.github.io/career_opportunities/admin.html` and select **Sign in with GitHub**. Choose the allowlisted account and authorise the app. You should return to the admin page on the Worker origin.
2. Confirm the displayed signed-in identity is the intended administrator. The Worker checks both the allowlist and repository write permission.
3. Open an uncertain listing's original advert. Confirm relevance and that it is still available, then use the admin decision controls. An inclusion decision does not turn missing salary, funding or eligibility into verified facts.
4. Confirm the save succeeded and inspect the resulting `data/review-queue.json` commit in GitHub. Wait for **Check opportunities and publish Pages** to finish before expecting the public board to change. The commit uses your GitHub App user token; the site's normal push workflow handles publication.
5. Sign out and confirm the queue API is no longer available in that browser session. If practical, test that a separate, non-allowlisted GitHub account cannot access it.

Only use a real listing you intend to include or exclude for the save test. A successful login alone does not prove that repository branch rules permit the write or that Pages deployed successfully.

## If something stops

| Message or symptom | Check |
| --- | --- |
| Admin setup is incomplete, or API returns 503 | Worker `GITHUB_CLIENT_ID` and both secrets are configured; redeploy after editing the configuration. |
| GitHub rejects the callback | The registered callback is the exact active Worker origin plus `/auth/callback`. |
| Access denied | Correct GitHub account selected, its username allowlisted, app installed on this one repository, Contents read/write granted, and the account has repository write access. |
| Session expired | Sign in again. The portal session lasts one hour; it does not retain refresh tokens. |
| Queue changed / conflict / HTTP 409 | Reload the queue and review the current candidate again. A saved SHA and candidate snapshot prevent overwriting changes made since your review. |
| Save blocked by branch rules | Check whether the account/app is allowed to make the required direct queue commit. This version does not bypass a pull-request requirement. |
| Saved decision has not appeared publicly | Check the new commit and Pages workflow run. A save is not a completed deployment. |

The session cookie is encrypted, HttpOnly, Secure and SameSite=Lax; frontend JavaScript cannot read the GitHub token. The cookie holds encrypted session data, so no separate session database is required. Signing out clears the browser session; rotating `SESSION_SECRET` invalidates all existing portal sessions. Repository data remains public where the repository is public—login controls the ability to make decisions.

## Official references

- [Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
- [Installing a GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party)
- [GitHub App user access tokens and PKCE](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [GitHub Contents API](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)
- [Cloudflare deployment with Wrangler](https://developers.cloudflare.com/workers/get-started/guide/)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Worker routing before static assets](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
