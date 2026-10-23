# Shared hosting and operations

The shared app is a static Vite frontend backed by Supabase Postgres and Google Auth. Cloudflare Pages can host the frontend on its free plan. No cloud resources are created by the repository. Live Google OAuth, public guest links, and deployed multi-device behavior must be verified after configuring your accounts.

## Choose local or shared mode

Without either cloud setting the original localStorage app runs and includes committed `history.json`. It can still be built for GitHub Pages with `npm run build -- --base=/poker-live/`; the existing Pages workflow is unchanged. Both themes and TV mode remain available.

For shared mode, copy `.env.example` to `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
```

These values are compiled into browser assets. Use the project's **publishable** key, never a secret/service-role key, database password, Google client secret or access token. `.env` files are ignored. Restart the dev server or rebuild after changes. Supplying only one setting fails the build and dev startup. The build also rejects URLs containing credentials and secret/service-role keys; a legacy anon JWT is accepted. A configured build resolves `virtual:poker-seed` to empty data without reading `history.json`. Old localStorage remains local; it is never automatically sent to Supabase.

## Database setup and security checks

Install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) and Docker for local integration checks. Run from the repository root:

```sh
npm ci
npm test
bash scripts/test-database.sh
```

The database runner starts a disposable `postgres:17-alpine` container, installs a minimal Supabase Auth test shim, applies migrations and exercises the SQL API as database roles. It does not connect to or reset a hosted database. These tests verify database authorization and transactions; they do not validate a running Supabase Auth service or Google consent flow.

Create a new Supabase project in your chosen region, retain the database password securely, then authenticate and link the CLI to **that new project**:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push --dry-run
supabase db push
```

Review the dry run before applying. The migration is `supabase/migrations/202610230001_shared_poker.sql`. Alternatively, run its full contents in that project's SQL Editor with the database owner role. Do not run test bootstrap SQL on a hosted project. Use one migration method consistently; SQL Editor application does not automatically record CLI migration history.

The normalized tables live in `poker_private`; leave this schema out of the Data API exposed schemas. The `public.poker_*` functions are the client API. Keep migration RLS, grants, fixed search paths and role checks intact: authenticated owner writes, approved member reads, own approved linked personal results, and anonymous active-session projections only. Do not grant browser roles direct table access or mark private tables for anonymous Realtime subscriptions. The browser only needs the public key; SQL functions verify the authenticated identity. Review membership and player links from the host account before granting access.

## Google sign-in

Follow the official [Supabase Google provider guide](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) and [redirect URL guide](https://supabase.com/docs/guides/auth/redirect-urls).

1. In Google Cloud Console, configure the OAuth consent screen and create an OAuth client of type **Web application**. While the consent screen is in testing, add every intended tester as a test user; publish/configure the consent screen for your eventual audience.
2. In Google, add the web app origins you actually use, such as `http://localhost:5199` and `https://YOUR_SITE.pages.dev`, to Authorized JavaScript origins. Add the callback displayed in Supabase's Google provider settings to Google's Authorized redirect URIs: normally `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`. This is the Supabase callback, distinct from the app URL.
3. In Supabase Authentication → Sign In / Providers → Google, enable Google and save the Google client ID and secret. The secret stays in the provider configuration. Disable other sign-in providers you do not intend to offer.
4. In Supabase Authentication → URL Configuration set Site URL to the stable frontend URL, for example `https://YOUR_SITE.pages.dev/`. Add that same exact app URL and `http://localhost:5199/` to the redirect allow list. If using a subpath, include the full path and trailing slash, for example `https://USER.github.io/poker-live/`. Add each trusted preview/custom domain explicitly when needed; avoid broad production wildcards.
5. Restart the configured app and test Google sign-in, sign-out and a second browser. The app uses fragment routes for group/guest navigation and returns OAuth to its app base URL, retaining guest context in browser session storage. Do not register a guest bearer token as an OAuth callback. Test the round trip starting from an active guest QR link as well as the home screen.

Use the displayed Supabase callback value if it differs (for example with local Supabase or a custom Auth domain). A local Supabase instance has its own provider credentials and callback; configuring the hosted project does not configure it.

## Cloudflare Pages

Use the repo root as the project root, build command `npm run build`, output directory `dist`, and Node 22.18+ (set `NODE_VERSION` to a supported current Node 22 patch). Set **both** public Vite variables in the Pages production environment before the first build. Set them separately for previews only when previews should access a backend, preferably a separate test project. The frontend uses hash routes so guest links need no server path rewrites. Cloudflare serves the static files; database and authentication requests go directly to Supabase.

Choose a project creation method deliberately. [Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/) builds on pushes to your chosen repository/branch. [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) deploys prebuilt assets; Cloudflare documents that switching project integration methods requires a new project. With Direct Upload, build locally with both settings, run the privacy check, then upload the **contents of `dist`** through the dashboard or deploy with Wrangler:

```sh
npm ci
npm test
npm run build
node scripts/check-cloud-privacy.mjs
npx wrangler pages deploy dist --project-name YOUR_PAGES_PROJECT
```

Only run the deployment command when ready to publish to your own configured project. Direct Upload does not run your build or inject Vite variables into already built files. Rebuild for environment changes. For Git integration, check the production branch, build logs and environment variables before promoting a preview. Confirm the resulting domain in Supabase's redirect allow list, then repeat sign-in checks on that exact origin.

CI runs frontend tests, a local build, a partial-configuration failure check, a configured shared build with dummy public values, an asset scan for legacy player names/IDs and session IDs, and the isolated database tests. Dummy CI settings are not a working backend. Do not upload a local-mode `dist` to a shared site: local builds intentionally contain committed history. For an independent privacy check:

```sh
VITE_SUPABASE_URL=https://example.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ci_placeholder_not_a_real_key npm run build
node scripts/check-cloud-privacy.mjs
```

The scanner reads all emitted files, including any source maps. It is a regression check against the repository seed, not a general secret scanner or protection for data already committed to Git.

## Import, membership and live games

Export JSON from the local app first and keep an untouched backup. Sign in to the shared app, create/select the intended group as its host, and explicitly choose its JSON import control. The import confirmation shows the parsed player/game counts and destination group name. Confirm only after checking them; cancellation sends no changes. Shared Settings keeps field edits locally until you choose Save changes; polling retains unrelated fresh records and conflicting edits from another device require reopening Settings to review current values. Import is a separate explicit action and keeps unrelated pending settings edits open. Nothing is uploaded merely by opening a configured app. Import preserves stable IDs, adds absent records and rejects conflicting existing records; repeating the same import must not duplicate events. It cannot replace a shared group while a game is active. End that game before importing historical data. An exported active local game remains active unless you end it locally before exporting.

The host is the group's single banker and editor; host transfer/multiple bankers are not provided. Players need not have accounts. A signed-in viewer requests membership and the host approves and links the account to the correct existing player. Never link a person to someone else's player to troubleshoot access. Revoking membership removes private group/personal access through that link.

Generate a guest QR only for an active game. Anyone with the bearer link can see its active-game projection, so share it only with the intended audience. Rotate/revoke after accidental disclosure. Ending the game invalidates the guest projection. Guests receive no private history or identities. Updates use polling, not broad database subscriptions; multiple TVs and phones consume requests and bandwidth. Writes require a connection. After a conflict, refresh and inspect the authoritative game before entering the change again; do not repeatedly click a failed buy-in or assume an offline edit was recorded.

## Backups and moving providers

Keep local JSON exports and periodic host exports of each shared group in secure storage outside the repository. JSON covers poker data; it does not back up Auth identities, memberships, ownership, sharing tokens or migration history. Treat database dumps as private: they may contain account data and active guest tokens. Back up before schema changes and rehearse restoration into a separate project.

For a full Supabase move follow its current [backup/restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). Obtain a direct or session-pooler connection from the project's Connect panel (not the transaction pooler), and use a secure environment/prompt for credentials. The CLI can produce separate role, schema and data backups:

```sh
supabase db dump --db-url "$POKER_DB_URL" --role-only -f /secure/backup/roles.sql
supabase db dump --db-url "$POKER_DB_URL" -f /secure/backup/schema.sql
supabase db dump --db-url "$POKER_DB_URL" --data-only --use-copy -f /secure/backup/data.sql
```

Check CLI defaults/exclusions, including whether your intended schemas and Auth records are present. Preserve `supabase_migrations` separately if you need CLI migration history; the official guide gives those commands. A database dump does not copy dashboard Auth provider credentials, allowed redirect URLs, platform settings, database passwords, Storage file contents or frontend environment variables. Auth/Vault encrypted data may require the additional encryption-key migration steps in the official guide. Restore into an isolated project first and follow the guide's managed-role/ownership handling rather than blindly importing privileged roles. Reconfigure Google callbacks and force/retest sign-in as needed; preserving only poker rows without their referenced Auth user UUIDs breaks ownership and memberships.

For a portable application-schema archive with PostgreSQL tools, use matching/newer client tools and include both application schemas:

```sh
pg_dump --dbname="$POKER_DB_URL" --format=custom --no-owner --no-acl \
  --schema=public --schema=poker_private --file=/secure/backup/poker.dump
pg_restore --list /secure/backup/poker.dump
```

This scoped dump intentionally omits Auth users and removes grants, so it is **not** a complete working restore. On a separate initialized target, reconcile schema migrations, provision/preserve Auth UUIDs, restore using `pg_restore --no-owner --no-acl --dbname="$POKER_RESTORE_DB_URL" /secure/backup/poker.dump`, and reapply/audit the migration's grants and policies. Do not overlay a full schema archive on an already migrated database without a tested restore plan; duplicate objects or conflicting rows will fail. Review privileges before exposing the target API.

The data is ordinary Postgres and the migration SQL/RPC contract can support future web/native clients. Moving away from Supabase also requires replacing its Auth/JWT identity integration, Data API transport and OAuth session handling. Realtime is not required by this app; if you add it later, publications and authorization must be recreated and audited during a move. A SQL dump alone does not supply those services.

## Free plans and verification before use

Review current [Supabase billing/usage](https://supabase.com/docs/guides/platform/billing-on-supabase) and [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/) before inviting a group. Free plans have changing database, storage, Auth, egress, build and request quotas; polling consumes backend requests/egress even when nobody edits. No paid add-ons or automatic billing setup are required by this implementation. Monitor usage and keep backups; availability is not guaranteed for a free social game.

Supabase currently documents [pausing low-activity free projects over a seven-day period](https://supabase.com/docs/guides/platform/free-project-pausing). Check the project and wake it before game night. Its [backup guide](https://supabase.com/docs/guides/platform/backups) recommends off-site CLI exports for free projects; do not assume paid daily backups/PITR are included.

Before importing real history, verify on the deployed site with separate accounts/browser sessions: host writes; unapproved and revoked accounts cannot read; approved accounts see the correct group and own linked results; a second group is isolated; simultaneous host writes conflict safely; guest rotation/revocation/ending clears access; temporary network failure labels stale data and does not queue edits; Google round trips retain guest context; both themes work on a phone and TV. Repository checks do not constitute evidence that these live account/deployment steps have passed.
