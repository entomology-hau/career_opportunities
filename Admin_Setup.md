# Admin login setup

**Updated 8 October 2026.** The optional **Admin sign-in** link is in the public board's footer. Direct and related-field source matches continue to publish automatically, with per-card relevance and missing-information caveats. Admin sign-in is for maintainer decisions; it is not a requirement for automatic publication.

The Worker and GitHub App are already configured for this repository, and commits to `main` deploy through the existing Cloudflare connection. Use this guide to maintain or recreate that setup. Reports and maintainer-controlled removals also remain available through GitHub Issues.

## Current configuration

Enabling sign-in does not switch the board into approval mode. Test sign-in and any intended admin decision separately from automatic publication.

Public configuration for `entomology-hau/career_opportunities`: repository ID `1397618839`, Worker origin `https://hau-opportunities-admin.entomology-hau.workers.dev` and GitHub App Client ID `Iv23liJPuPSTZcVYxYfu`. These values are committed in the configuration files. The repository ID is public metadata, not the GitHub App ID or a secret.

In the retained implementation, the public board stays on GitHub Pages and the separate admin interface uses a small Cloudflare Worker for GitHub sign-in and queue decisions. The Worker hosts that interface and its API together. Changes are committed to `data/review-queue.json`; the existing Pages workflow can apply saved decisions. The queue and audit are stored in a public repository, so sign-in restricts actions rather than making that metadata private.

You can complete the setup in your browser without installing software or having administrator rights on your PC. You need access to the repository owner's GitHub settings and a Cloudflare account. Cloudflare will run the deployment commands on its servers.

## 1. Upload the project to GitHub

Open [entomology-hau/career_opportunities](https://github.com/entomology-hau/career_opportunities) while signed in to the account that can update it. The admin implementation is already present. If recreating the project, use its current repository files rather than an older update ZIP.

Upload the contents of the extracted project folder, preserving its folders. Do not upload the ZIP itself or create an extra enclosing project folder. In particular, the repository must contain `admin-backend/wrangler.jsonc`, `admin-backend/worker.js`, and the neighbouring `site` folder. Keep the supplied scripts, data and publishing workflow files together too.

The separately supplied `Admin_Secret_Generator.html` is a local setup helper; it does not need uploading to GitHub.

## 2. Create the Worker and obtain its address

In GitHub, open `admin-backend/wrangler.jsonc`. Keep its Worker `name` as `hau-opportunities-admin` and check its non-secret variables. Use the pencil button and **Commit changes** if you need to edit them:

| Variable | Value |
| --- | --- |
| `REPOSITORY` | `entomology-hau/career_opportunities` |
| `REPOSITORY_ID` | `1397618839`, the verified numeric ID of this repository |
| `BRANCH` | `main` |
| `ALLOWED_GITHUB_LOGINS` | The exact GitHub username that will sign in; initially `entomology-hau` |
| `PUBLIC_SITE_URL` | `https://entomology-hau.github.io/career_opportunities/` |
| `GITHUB_CLIENT_ID` | `Iv23liJPuPSTZcVYxYfu`, already filled in the supplied file |

`REPOSITORY_ID` is required. Keeping it in configuration removes the anonymous repository lookup that can fail when GitHub's unauthenticated rate limit is exhausted. The token request asks for access restricted to this ID, and the authenticated repository response must match both the ID and name and grant write permission. If deploying for a different repository, replace both repository settings with verified values; do not reuse this ID.

If `entomology-hau` is an organisation, it cannot sign in: use your individual GitHub username, which must have write access to this repository. For multiple administrators, use a comma-separated list of their exact usernames. An allowlisted username alone does not grant repository access.

Keep `assets.directory` as `../site`, its binding as `ASSETS`, `html_handling` as `none`, and `run_worker_first` as `true`. The relative assets path points to the neighbouring `site` folder. Cloudflare's monorepo setup runs the deployment from the configured project directory; keeping both folders in the same repository preserves this layout. The routing settings let the Worker handle authentication and API routes before serving files.

In the [Cloudflare dashboard](https://dash.cloudflare.com/):

1. Open **Workers & Pages → Create application**.
2. Select **Get started** beside **Import a repository**.
3. Connect GitHub if prompted. Select the GitHub account that owns `entomology-hau/career_opportunities` and allow Cloudflare access to this repository. This Cloudflare connection is separate from the admin GitHub App created in the next step.
4. Select **career_opportunities** and use the following settings. Some fields may be under advanced settings.

| Cloudflare setting | Value |
| --- | --- |
| Worker name | `hau-opportunities-admin` |
| Production branch / Git branch | `main` |
| Root directory | `admin-backend` |
| Build command | Leave empty |
| Deploy command | `npx wrangler@4 deploy` |
| Build variables and secrets | Leave empty |

5. Select **Save and Deploy** and wait for a successful deployment. Cloudflare runs the command; you do not enter it in a terminal on your PC. Its Builds connection supplies deployment authentication automatically.

The Worker name must match `name` in `admin-backend/wrangler.jsonc`. If prompted, choose your Cloudflare account's `workers.dev` subdomain. Copy the deployed HTTPS origin, such as `https://hau-opportunities-admin.your-subdomain.workers.dev`, without a trailing slash or `/admin.html`. Use this exact origin below.

For a new setup, the initial deployment should serve the admin interface, but **setup incomplete / HTTP 503** on sign-in or the API is expected until the required variables and runtime secrets are configured. Check that the first build succeeds before continuing.

## 3. Register a GitHub App

In GitHub, open the repository owner's **Settings → Developer settings → GitHub Apps → New GitHub App**. For an organisation-owned app, use that organisation's settings. Register a **GitHub App**, rather than an OAuth App or personal access token.

Set:

| Setting | Value |
| --- | --- |
| App name | A unique name such as `HAU Opportunities Admin` |
| Homepage URL | `https://entomology-hau.github.io/career_opportunities/` |
| Callback URL | `https://hau-opportunities-admin.entomology-hau.workers.dev/auth/callback` |
| Expiring user authorisation tokens | Keep enabled |
| Request user authorisation during installation | Leave unchecked; the admin page starts sign-in separately |
| Device flow | Leave disabled |
| Webhook: Active | Uncheck; this app does not use webhooks |
| Repository permissions: Contents | **Read and write** |
| Repository permissions: Metadata | Read-only, included automatically |
| Other repository, organisation and account permissions | No additional permissions |
| Where can this GitHub App be installed? | **Only on this account** |

The callback must match exactly. Do not add a wildcard, query string or the GitHub Pages project path to it.

GitHub's Contents permission applies to the selected repository; the Worker limits its write endpoint to queue decisions in `data/review-queue.json`.

Create the app. Copy its **Client ID**; the numeric App ID is a different value. This design does not need an App private key.

On the app's settings page, choose **Install App**, select the repository owner, choose **Only select repositories**, and select only **career_opportunities**. Installation and user sign-in are separate steps; both are needed. The app should not be installed across all repositories.

Back in the GitHub repository, edit `admin-backend/wrangler.jsonc`. Set `GITHUB_CLIENT_ID` to `Iv23liJPuPSTZcVYxYfu` and commit to `main`, or replace that file with the supplied configured version. Wait for Cloudflare's automatic build to finish. Client IDs are public configuration, so this belongs in the file. Do not set it only as a plain dashboard variable: the next Wrangler deployment would replace that value with the file's configuration.

## 4. Add the two Worker secrets

On the GitHub App's settings page, generate a **client secret**. Keep its value ready to paste directly into Cloudflare.

For the session encryption secret, download the supplied `Admin_Secret_Generator.html` file and open it locally in your browser. Select **Generate key**, then **Copy key**. The helper uses the browser's cryptographic random generator to create 32 random bytes, displayed as 64 hexadecimal characters. It sends no requests and needs no installation or developer console. Paste the generated value directly into Cloudflare; do not save the value in GitHub or send it to chat.

In Cloudflare, open **Workers & Pages → hau-opportunities-admin → Settings → Variables and Secrets → Add**. Add both entries below with the type **Secret**:

| Variable name | Secret value |
| --- | --- |
| `GITHUB_CLIENT_SECRET` | The client secret generated by GitHub |
| `SESSION_SECRET` | The 64-character value from the local helper |

Use **Add variable** to add the second entry if available, then select **Deploy** to apply the changes. These must be runtime secrets under **Variables and Secrets**. The similarly named **Build variables and secrets** section only supplies values while Cloudflare builds the project and does not configure this login.

Store these values only as Worker secrets. Do not put them in `wrangler.jsonc`, GitHub Pages files, a commit or chat. Subsequent Wrangler deployments preserve encrypted secrets. Close the local helper when finished.

Keep the same Worker name and origin. If either changes, update the GitHub App callback and the setting in the next step as well.

## 5. Connect the public site's Admin link

In GitHub, use the pencil button to edit `site/admin-config.json` so `apiBase` is your full Worker origin:

```json
{
  "apiBase": "https://hau-opportunities-admin.entomology-hau.workers.dev"
}
```

This address is public and contains no credential. Commit the change to `main` and wait for the **Check opportunities and publish Pages** workflow to finish. Keep this existing Pages publishing workflow enabled. GitHub Pages hosts the public board; the Worker serves its own admin configuration for same-origin API calls after sign-in.

With the GitHub connection set up in step 2, later commits to `main` automatically deploy the Worker through Cloudflare Builds too. No local deployment command is required. GitHub Pages and Cloudflare have separate deployment results; check the relevant result if an update has not appeared.

## 6. Verify sign-in and a decision

1. Open `https://entomology-hau.github.io/career_opportunities/admin.html` and select **Sign in with GitHub**. Choose the allowlisted account and authorise the app. You should return to the admin page on the Worker origin.
2. Confirm the displayed signed-in identity is the intended administrator. The Worker checks both the allowlist and repository write permission.
3. Open an uncertain listing's original advert. Confirm relevance and that it is still available, then use the admin decision controls. An inclusion decision does not turn missing salary, funding or eligibility into verified facts.
4. Confirm the save succeeded and inspect the resulting `data/review-queue.json` commit in GitHub. Wait for **Check opportunities and publish Pages** to finish before expecting the public board to change. The commit uses your GitHub App user token; the site's normal push workflow handles publication.
5. Sign out and confirm the queue API is no longer available in that browser session. If practical, test that a separate, non-allowlisted GitHub account cannot access it.

Only use a real listing you intend to include or exclude for the save test. A successful login alone does not prove that repository branch rules permit the write or that Pages deployed successfully.

## Optional: avoid Worker rebuilds for routine advert updates

After the setup works, open **Cloudflare → your Worker → Settings → Build → Build watch paths**. Replace the default include-all rule with these include paths, leaving exclude paths empty:

```text
admin-backend/*
site/admin*
site/styles.css
site/assets/*
```

These match paths in repository push events, starting with the repository folder names. Cloudflare documents `*` as a wildcard matching zero or more characters, including its examples for changes within directories. The rules include the Worker code and admin assets while avoiding a Worker rebuild for routine queue or advert data changes. They do not alter the GitHub Pages workflow. After configuring them, confirm that the next intended admin update starts a Cloudflare build.

## If something stops

| Message or symptom | Check |
| --- | --- |
| Cloudflare cannot find the Worker or assets | Root directory is `admin-backend`; the repository contains its `wrangler.jsonc` and the neighbouring `site` folder, without an extra enclosing folder. |
| Cloudflare rejects the Worker name | Both the dashboard name and `name` in `wrangler.jsonc` are `hau-opportunities-admin`. |
| Admin setup is incomplete, or API returns 503 | Confirm `REPOSITORY_ID` and Client ID are committed in the config and successfully deployed; both secrets must be runtime Secrets and their change deployed. |
| Rate-limited anonymous repository lookup | This anonymous lookup was removed on 8 October 2026. Confirm the latest Worker deployment succeeded, then start a fresh sign-in. |
| GitHub rejects the callback | The registered callback is the exact active Worker origin plus `/auth/callback`. |
| Access denied | Correct GitHub account selected, its username allowlisted, app installed on this one repository, Contents read/write granted, and the account has repository write access. |
| Session expired | Sign in again. The portal session lasts one hour; it does not retain refresh tokens. |
| Queue changed / conflict / HTTP 409 | Reload the queue and review the current candidate again. A saved SHA and candidate snapshot prevent overwriting changes made since your review. |
| Save blocked by branch rules | Check whether the account/app is allowed to make the required direct queue commit. This version does not bypass a pull-request requirement. |
| Saved decision has not appeared publicly | Check the new commit and Pages workflow run. A save is not a completed deployment. |

The session cookie is encrypted, HttpOnly, Secure and SameSite=Lax; frontend JavaScript cannot read the GitHub token. The cookie holds encrypted session data, so no separate session database is required. Signing out clears the browser session; rotating `SESSION_SECRET` invalidates all existing portal sessions. Repository data remains public where the repository is public—login controls the ability to make decisions.

## Optional: deploy from a terminal

The browser workflow above is sufficient. If you already have Node.js LTS and npm available and prefer Wrangler, run these commands from the project's `admin-backend` folder:

```sh
npx wrangler@4 login
npx wrangler@4 deploy
```

You can also enter the GitHub client secret into Wrangler's prompt:

```sh
npx wrangler@4 secret put GITHUB_CLIENT_SECRET
```

Or generate and send the session secret directly to Wrangler:

```sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))" | npx wrangler@4 secret put SESSION_SECRET
```

Deploying from a local copy uses that copy's configuration; keep its public settings in sync with the repository. The Cloudflare GitHub connection will continue deploying later commits to `main`.

## Official references

- [Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
- [Installing a GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party)
- [GitHub App user access tokens and PKCE](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [GitHub Contents API](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)
- [Cloudflare Workers Builds: import a repository](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Cloudflare build settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Cloudflare monorepo setup](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/)
- [Cloudflare build watch paths](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/)
- [Wrangler configuration as the source of truth](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth)
- [Cloudflare deployment with Wrangler](https://developers.cloudflare.com/workers/get-started/guide/)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Worker routing before static assets](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)

