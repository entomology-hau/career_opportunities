# Research toolkit administration

The [Research toolkit](https://hau-opportunities-admin.entomology-hau.workers.dev/research.html) provides private risk assessments, protocols and SOPs for HAU MRP and PhD students. The public [hub tab](https://entomology-hau.github.io/career_opportunities/hub/?section=research) links to it.

## First use

1. Open [Research toolkit administration](https://hau-opportunities-admin.entomology-hau.workers.dev/research-admin.html) and sign in with the existing authorised GitHub account.
2. Set a shared passphrase of at least 16 characters and its expiry date, no more than 366 days ahead. Keep the password out of GitHub and chat.
3. Add the email addresses students will use as usernames. Email matching is case-insensitive; surrounding spaces are removed.
4. Upload the approved documents, choosing Risk assessment, Protocol or SOP. Add a useful title, description, version and review date.
5. Share the toolkit URL and current passphrase with approved students using your usual university channel.

Until the password and an approved email are configured, student access remains closed. No default password, sample students or sample research documents are created.

## Ongoing management

Use the same admin page to add or remove email usernames, upload documents, remove superseded documents, and change the shared passphrase. Every password change invalidates existing student sessions. Removing a username revokes its active access; adding that username again does not restore its previous sessions. Password expiry also closes student access until an administrator renews it. The expiry date is displayed in the portal; renewal is an administrator action, not an automatically emailed password.

Documents support PDF, DOC/DOCX, XLS/XLSX, TXT and CSV, up to 10 MiB each. The initial library limit is 100 MiB in total and 500 documents. Downloads require an active authorised session and are delivered as attachments. The administrator should retain original copies; this portal is not the university's document-approval system. A listed review date does not itself approve a procedure or risk assessment.

Approved email addresses are usernames, not verified email identities: anyone with both an approved username and the shared password can use them. This is the requested shared-password model, rather than university single sign-on. A downloaded copy cannot subsequently be recalled by removing access.

## Hosting and storage

The public pages remain on GitHub Pages. The existing `hau-opportunities-admin` Cloudflare Worker serves the student and admin portals on one origin, avoiding cross-site cookies. Its existing GitHub App and runtime secrets continue to protect admin access.

`admin-backend/wrangler.jsonc` adds the `RESEARCH_LIBRARY` binding and the `research-v1` SQLite Durable Object migration. The normal Cloudflare GitHub build creates this private storage; no separate bucket or database ID is required. Keep this binding, class name, migration history and the object name `hau-research-v1` stable on subsequent deployments. Do not delete the object or remove migrations to reset login settings.

Passwords are stored as salted derived hashes. Email usernames, document metadata, document bytes, student sessions and login throttles are stored privately in the Durable Object, not in the repository or static assets. Private responses use `Cache-Control: no-store`. User and password checks happen on each protected request, including downloads. The student cookie is Secure and HttpOnly; passwords and tokens are not kept in browser storage.

Cloudflare and GitHub Pages have separate deployment results. A successful Pages run alone does not verify the private service. If Cloudflare build-watch paths are enabled, include:

```text
admin-backend/*
site/admin*
site/research*
site/styles.css
site/assets/*
```

The existing `SESSION_SECRET` and GitHub App setup are described in [Admin_Setup.md](Admin_Setup.md). No new secret is required for the student password: set and rotate it in the authenticated research admin page. Do not store private documents or an email list under `site/` or commit them to this public repository.

## Checks

From the repository root:

```sh
node --test admin-backend/test-worker.mjs admin-backend/test-research.mjs admin-backend/test-research-integration.mjs
node tests/test_admin.cjs
node tests/test_board.cjs
```

The tests use in-memory storage and mocked GitHub requests. They do not create live students or documents. Before sharing with students, set your own password and approved list, upload an approved document, and check sign-in and download with an intended test account.
