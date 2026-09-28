# Cloudflare Pages deployment

FBAR Magician is a static browser application. Cloudflare serves its code and
public assets; PDF parsing, editing, comparison and generation run on the user's
device. There are no Pages Functions, database bindings, file upload endpoints,
analytics scripts or application secrets.

## Project configuration

- Pages project: `fbarmagician` (Cloudflare requires lowercase project names).
- GitHub repository: `jerenrich/FBAR-Magician`.
- Production branch: `main`; pushes trigger production builds.
- Preview branches: enabled for other branches.
- Root directory: `prototype`.
- Build command: `npm run build`.
- Build output directory: `dist`.
- Node version: `24.21.0`, pinned in `prototype/.node-version`.
- Framework preset: None.

Connect the repository using Cloudflare's native Git integration when creating
the project. Do not create a Direct Upload project first: it cannot later be
converted to native Git integration. The Cloudflare GitHub App must be authorized
to access this repository.

## Local build and verification

From the repository root:

```sh
npm --prefix prototype ci
npm --prefix prototype run build
npm --prefix prototype run preview
```

In another terminal, with Google Chrome installed:

```sh
npm --prefix prototype run test:pages
node prototype/scripts/security-test.cjs
node prototype/scripts/usability-test.cjs
```

The Pages smoke test can also check the deployed site:

```sh
npm --prefix prototype run test:pages -- https://fbarmagician.pages.dev
```

It uses only synthetic data, checks security headers and excluded paths, and
exercises preview, PDF export/import, comparison, save/resume and offline export.
It rejects external requests and upload requests. Downloads stay in ignored
`prototype/results/pages/`.

For a deliberate manual production deployment after `wrangler login`,
`npm --prefix prototype run deploy` builds and uploads the same isolated output.
Normal releases should use Git so the production source is recorded on `main`.
Cloudflare's dashboard supports rolling back to a previous successful production
deployment without changing the repository.

## Structure and publication boundary

`prototype/asset-manifest.cjs` is the shared public asset allowlist for the local
server and static build. `scripts/build-pages.cjs` recreates `prototype/dist/`,
copies only approved files, rejects symlinks and oversized files, includes vendor
licenses, and generates Pages security headers and a real 404 page. Never deploy
the repository root or the whole `prototype` directory.

The build includes the unchanged official blank and three plain synthetic XML
examples. QA outputs, developer scripts, other fixture files and local working
documents are excluded. The existing Content Security Policy and no-store
response policy are shared with local development. No service worker is added;
reopening the app still requires a connection, while warmed document operations
can run offline.

Keep the existing `prototype` source paths for this deployment: the tests and
technical reports refer to them extensively. A later refactor can split
`pdfjs/app.mjs` into session state, table rendering, dialog handling and file
workflow modules. Preserve `data-model.mjs`, `pdf-reader.mjs` and
`xfa-packet-writer.mjs` as separately testable boundaries. A framework migration
or backend is unnecessary for this hosting change.

The hosted app retains its prototype status and existing limitations. Hosting
does not add signing, filing submission, or additional Adobe Reader qualification.

References: [GitHub integration](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/),
[Pages headers](https://developers.cloudflare.com/pages/configuration/headers/),
[Direct Upload restrictions](https://developers.cloudflare.com/pages/get-started/direct-upload/).
