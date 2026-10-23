# Poker Live ♠

A home cash-game tracker for phones, laptops and the TV: buy-ins, rebuys, cash-outs, settle-up and history, with two themes and generated jazz.

Run with Node 22.18+ (or a current supported Node release):

```sh
npm ci
npm start   # http://localhost:5199
npm test
npm run build
```

With no cloud configuration this is the original **local-only** app. Data lives in that browser's localStorage. `history.json` seeds missing players and nights into each browser; export JSON before clearing browser storage. Test on another port (`npx vite --port 5198`) to keep test data out of your usual browser history. The existing [GitHub Pages site](https://prakritd.github.io/poker-live/) uses this local mode.

For private shared groups, copy `.env.example` to `.env.local` and set both `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Restart Vite after changing them. Shared builds exclude committed history and never upload browser data automatically. A group host signs in with Google, creates a group, records games, approves member requests and links accounts to players. Approved members can read that group; personal results use approved player links. A revocable QR link shows guests only the active game. Recording requires a connection; concurrent changes are rejected and refreshed instead of overwriting another host device.

[Hosting and operations](docs/hosting.md) covers Supabase migrations, Google OAuth, Cloudflare Pages, explicit import, database security tests and portable backups. This repository provides setup code; a live shared deployment and live Google sign-in still require account configuration and end-to-end verification.

```sh
bash scripts/test-database.sh  # isolated disposable Postgres; Docker required
VITE_SUPABASE_URL=https://example.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ci_placeholder_not_a_real_key npm run build
node scripts/check-cloud-privacy.mjs
```

Design notes for the original tracker: [docs/plan.md](docs/plan.md).
