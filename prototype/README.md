# FBAR Magician prototype

FBAR Magician is a local editor prototype that exports one tested template and imports compatible prior variants as data only. It supports data-only import, all cataloged input tables, year rollover, checked unsigned export and comparison with a saved PDF. Final review/signing happens in Adobe Reader. All QA fixture data is invented. **Never submit these PDFs. Never pass a personal PDF to the public SDK demo.**

Synthetic text values use only ASCII letters, digits and spaces. This user preference is recorded in [AGENTS.md](../AGENTS.md) and applies to new fixtures and negative-test data as well.

The [PDF.js report](../output/fbar-pdfjs-feasibility.md) explains the free draft/preview experiment. The earlier [Foxit resolution report](../output/fbar-export-feasibility.md) covers the commercial signing experiment.

## PDF.js local table experiment

Install the dependencies with `npm --prefix prototype install` from the repository root, using Node.js 22.13 or later. Then run:

```sh
node prototype/pdfjs/server.cjs
```

Open `http://127.0.0.1:3141` and start a blank draft or import a completed FBAR locally. Synthetic fixtures remain available to the local tests. See the [current workflow](../output/fbar-local-workflow.md) for import, rollover, comparisons, native qualification and limits. Choose Preview to refresh the read-only preview, or download an unsigned writer draft (download also applies pending table edits). The app creates one temporary in-memory PDF Blob, reads it back in a local worker, compares populated fields, record counts and the saved visible birthday with the editor, then gives that same Blob to the browser to download. The popup reports the automatic reconciliation percentage and lists every mismatch if export is blocked. This verifies the exact PDF payload handed to the browser without a second file selection; it cannot confirm that the browser wrote the file to disk. Import completed FBAR and Compare a saved PDF parse the selected file when the user later opens it; the comparison checks that file against current editor entries. PDF.js's own diagnostic export is hidden unless `?diagnostics=1` is added: it loses XML namespaces and does not preserve all visible edits. Embedded Sign/Validate/+ controls do not work in this viewer. This is not a filing application.

Run `node prototype/scripts/export-reconciliation-test.cjs` to exercise the automatic in-memory check, load a downloaded synthetic PDF, and inject a changed field into the in-memory PDF before comparison. The test asserts that the changed field is listed, the percentage falls below 100, and no download starts. The percentage counts matching populated PDF fields, repeated record counts, and a populated visible birthday; blank field placeholders are excluded.

All document processing runs in the browser. The loopback server serves static assets only. To reproduce the browser experiment and independent verification, use installed Google Chrome and Python with `pypdf==6.10.0`:

```sh
node prototype/scripts/pdfjs-test.cjs
python3 prototype/scripts/verify_pdfjs.py
```

The test blocks external requests, exercises 1/3/20-account layouts, edits the table to 24 accounts, downloads the draft, and characterizes native-save failures. The verifier checks 209 populated values, XML namespaces, account count and template preservation. A passing characterization test includes expected failures of native PDF.js export. Outputs in `results/pdfjs/` are synthetic QA artifacts.

`FBAR_PDFJS_DIST` optionally points to an extracted `pdfjs-dist` package instead of the installed package. No Foxit service or license is used by this test.

## Security regression checks

Run `node prototype/scripts/security-test.cjs` from the repository root. It uses the public blank and plain synthetic values to check encoded path traversal, private-file and symlink rejection, compressed PDF limits, saved-work complexity limits, preservation of the current draft, offline recovery, and termination of a stalled parser. Malformed PDFs are built in memory and are never sent to an external service. The timeout case takes 15 seconds.

The server exposes an explicit application asset list and selected PDF.js runtime resources. Other files placed in `fixtures/`, `pdfjs/`, or `results/` are not public. PDF imports and comparisons run in a local worker with a 15-second deadline, a 16 MiB limit per decompression buffer, and a 64 MiB aggregate decompression buffer budget per request. Only the template, datasets and saved form packets are returned to the editor. XML is limited to 8 million characters, 100000 markup openings and 64 levels of nesting; imports allow at most 1000 combined account and repeated owner records. These are prototype resource limits, not filing rules.

The decompression guard uses the pinned pdf-lib 1.17.1 decoder internals inside the worker, including object streams and chained filters. Run the security suite when upgrading that dependency. A timed-out worker is discarded; restarting it requires the local asset server. Existing warmed-worker imports and comparisons can run offline. See the [security review](../output/fbar-security-review.md) for findings and validation.

Writer downloads now include a checksummed XFA state packet for the visible birthday. Native Reader tests confirmed two different DOBs appear without manual entry and survive field validation, save and reopen with all 177 input values intact. PDF.js's preview still shows a blank birthday. Details and reproduction: [Adobe handoff](../output/fbar-reader-handoff.md); tests: `dob-state-test.cjs`, `verify_dob_state.py`, and macOS `adobe_dob_test.py`.

The app enables `restoreAllAddresses` to restore filer, account, owner and preparer address choices; the earlier Part II option remains available for existing tests. The [quality review](../output/fbar-quality-review.md) records three native Reader address round trips and remaining limitations. Run the following from the repository root; the Adobe test requires macOS and the installed desktop Adobe application:

```sh
node prototype/scripts/address-state-test.cjs
node prototype/scripts/audit-ui-test.cjs
python3 prototype/scripts/verify_audit_ui.py
python3 prototype/scripts/adobe_address_test.py
python3 prototype/scripts/verify_synthetic_data.py
```

Run the synthetic data policy checker after generating QA artifacts. It examines business values, excluding original template/code-list content and allowing the exact required official version metadata.

The latest complete browser workflow is exercised by `local-workflow-test.cjs`; `adobe_branch_test.py` checks representative joint, signature-authority, preparer and consolidated cases in Reader. Signing evidence and scope are recorded in the current workflow report.

## Contents

- `asset-manifest.cjs`: shared allowlist and security headers for local development and the static Pages build.
- `scripts/build-pages.cjs`: creates the isolated, ignored `dist/` publishing folder. See [Cloudflare deployment](../CLOUDFLARE.md) for setup, automatic Git deployments and production smoke tests.
- `xfa-packet-writer.mjs`: browser JavaScript that appends a datasets update to one fingerprinted public blank PDF. Preserves the original bytes and template. It does not render or sign by itself.
- `foxit-xfa-adapter.mjs`: experimental bridge to native XFA widget events. Synchronizes the visible DOB and country-dependent requirements; invokes original Sign/Validate buttons. It depends on internal SDK interfaces requiring vendor support before production.
- `fixtures/`: public blank template, extracted schema/template and invented XML for 1, 3 and 20 separately owned accounts. No values from the user's completed PDF.
- `scripts/`: fixture generation, offline browser tests, synthetic SDK integration and independent verification.
- `results/`: synthetic engineering PDFs, screenshots, JSON evidence and logs. These are QA artifacts, not user filing outputs.

## Reproduce

Use Node.js 22.13 or later, Python 3.12 with `pypdf==6.10.0`, and installed Google Chrome. The JavaScript dependencies are pinned in `package.json`. Install with `npm --prefix prototype install` from the repository root. The browser SDK tests use Foxit's public demo and therefore need an initial network connection; no SDK license or commercial runtime is bundled here.

Run these commands from the repository root:

```sh
python3 prototype/scripts/make-synthetic.py
node prototype/scripts/browser-packet-test.cjs
node prototype/scripts/final-engine-test.cjs
node prototype/scripts/final-reopen-test.cjs
python3 prototype/scripts/verify_outputs.py
```

The browser writer test loads local dependencies, switches the browser offline, writes 1-, 3- and 20-account PDFs, and records all subsequent requests. The signing test substitutes the invented 20-account PDF for the demo's sample document, synchronizes fields, warms the save module, switches offline, and exercises the original signing acknowledgment. Its automatic acknowledgment is **test-only**; a production app must leave that action to the user.

The reopen test starts another browser session, inventories XFA widget values on every generated page, captures selected pages, and saves again. The Python verifier reads the PDF object graph and full concatenated XDP independently of the browser writer, checks expected populated values and account counts, and checks saved signing/DOB state. It asserts that template bytes and the original PDF prefix are preserved. It does not verify the Reader usage-rights signature or government acceptance.

Demo page consent dialogs, asset versions and font prompts can change. The test scripts are intentionally tied to the evaluated demo setup; this is not the application's proposed deployment. For a real app, obtain and self-host the licensed runtime and replace its internal widget bridge with a supported integration.

## Measured scope

- Three data-writing fixtures passed with zero requests while writing offline.
- The 20-account individual/UK-address fixture completed the native signing workflow and offline save.
- After a fresh reopen and second save, 177 populated input values, 20 account instances, the visible DOB, signing flag and timestamp remained correct.
- The viewer generated 13 pages. Account data was legible; counter labels and some footer text showed layout defects with the demo's font configuration.
- Parts III–V, nested owners, preparers and special reporting branches still need equivalent tests.
- A fully self-hosted distribution, licensing behavior, browser matrix, Reader rights and FinCEN acceptance remain production qualification work.

`node prototype/scripts/compatible-import-test.cjs` checks compatible prior-form layouts, recognized viewer metadata, trusted-template export, incompatible binding/data rejection, and retrying the same file after an error. Its fixtures contain only invented values from the public blank.

## Opening the editor

Use `http://127.0.0.1:3141/` while the local server is running. Opening `pdfjs/index.html` directly as a file cannot load the editor modules. The file copy now shows a recovery link and disables file selection. Startup also keeps entry controls disabled until the PDF library and app are ready, and displays a recovery message if either fails to load. Run `node prototype/scripts/startup-test.cjs` to check file-mode recovery, startup failures and synthetic imports through both HTTP entry paths.

## Editor usability regression checks

The app now uses the Ledger design. Overview, Filer details, Institutions, Owners, Accounts and Review are separate navigation sections. Accounts always shows every row in a compact table with full account numbers, small completion icons, inline edits only for maximum USD and an account edit dialog for all other fields. Dialog edits are staged separately from the report. Cancel or Escape discards them; Done enables only when changes exist and saves them as one Undo step. Previous/Next moves between accounts without saving pending edits. Preparing another year retains the source year maximum balance as hover text, including unknown and missing values. Save PDF preserves these references for a later editing session; the checked unsigned filing PDF includes only the new reporting values. Institutions and Owners use compact tables with Save/Cancel edit dialogs. Date of birth is a normal row in the compact filer table. Reporting context stays in the sidebar and action bar; the repeated summary strip and in-editor year-change section have been removed. Validation links open the correct section and account before focusing the field. Shared institution and owner editing, undo, year rollover and PDF actions continue to use the existing document model.

Section headings use direct labels, with Add actions beside them. Institution and Owner searches match names, addresses, country codes and IDs without changing report data. Account details highlight the selected row and offer previous/next navigation through all accounts. Validation links open the relevant dialog for account fields other than maximum USD. Overview points to Review as the next step. Import notes are collapsed by default; synthetic-data notices remain visible.

Run `node prototype/scripts/ledger-ui-test.cjs` for the current interface: section navigation, account editing and status icons, required import year choices, exact validation links, shared details, incomplete PDF save/reopen, unused shared records, undo, rollover, preview, checked export and 48 section/viewport/color-preference combinations. Synthetic screenshots and results are in `results/ledger/`. This supersedes the old all-fields-visible layout assertions in `ui-review-test.cjs` and `usability-test.cjs`. The editor styles are scoped away from the PDF preview. A preview does not save the draft; use Save PDF before leaving the page.

Run `pdf-save-test.cjs`, `currency-format-test.cjs` and `export-reconciliation-test.cjs` for saved PDF state, all reporting-category currency fields, and the exact checked download payload. The build allowlist includes `ledger.css` and `ledger-ui.mjs`; the separate design studies in `designs/` are not published with the app.

Run `node prototype/scripts/currency-format-test.cjs` to check comma formatting for maximum USD values in all four account sections. The test verifies that saved data and PDF export retain plain digits.

## Save and resume unfinished work

**Save PDF** starts a PDF download directly, even when required fields are missing or values are invalid. Its form data preserves unfinished entries. The app adds an editor-specific catalog entry only when unattached or identical institution or owner rows cannot be reconstructed from form fields, or when synthetic test data must retain its test-only status. Checked Reader handoff PDFs never include this entry. Saved PDFs contain sensitive personal and financial information; keep them in a private location. No automatic browser storage or network upload is added.

Use **Open FBAR** to reopen a saved PDF or import a completed one. The app checks saved work data against the PDF form data and preserves incomplete values. Signed state is never restored. Previously downloaded JSON work files can also be opened through this same control for migration. **Check & download unsigned draft** remains the validated Reader handoff; its output does not carry the editor's extra shared rows. The app can request a download but cannot confirm that the browser saved it, so users are told to check their downloads. Save-before-replacement also asks the user to confirm the downloaded copy is available.

The sticky action bar shows report year, account count and unsaved changes. Validation links open the exact affected field and add issue counts to sections. Institution Details holds each distinct institution name and address once, and each account selects an institution from a dropdown. Editing institution details updates all linked accounts while PDF export keeps the required per-account fields. Owners appears before Accounts and holds reusable owners for both Joint and Signature authority accounts. The Owner column selects the principal joint owner or signature authority account owner; editing an owner updates every linked account across both categories. Signature authority keeps the filer title with each account owner link and preserves repeated owner records from imported forms. Consolidated owner forms appear in the same Owners section. Account type descriptions, joint owner counts and removal actions remain in Accounts. The compact tables scroll horizontally on narrow screens. Institution and owner dialogs stage edits until Save; Cancel and Escape leave the report unchanged. Validation links open the shared record dialog at the affected field. Saved work retains unused institution and shared owner rows and their links; older work files and imported PDFs rebuild these shared rows from account data. Conditional sections hide unused empty fields; existing populated values remain visible to avoid concealing imported data. Undo retains the last 30 edits in memory, including account/owner removal and year rollover. New/import/resume actions protect unsaved edits, and rollover requires confirmation of the affected account count and cleared values. Opening any PDF or older work file requires a dialog choice: continue the detected year with imported values, or choose another year and explicitly clear annual values. Escape cannot dismiss the choice; from year entry it returns to the choices. Starting another year can be undone. Checked PDF downloads show the Reader review/sign/save/upload checklist separately from data-comparison success.

Run `node prototype/scripts/accounts-ui-test.cjs` for all account rows, compact status icons, prior-year hover references and saved PDF persistence, staged account edits, Cancel and Escape, Done enablement, add/remove cancellation, one Undo step per saved dialog and responsive layouts. Run `node prototype/scripts/dense-tables-test.cjs` for compact filer rows, consistent DOB, full account numbers, inline maximum balances and account edit dialogs, staged shared edits, linked updates, Undo, responsive dialogs and checked PDF export. Run `node prototype/scripts/pdf-save-test.cjs` for direct PDF save and reopen, including incomplete entries and unattached shared rows. Run `ledger-ui-test.cjs` for the current interface and browser workflows. Earlier table-interface evidence remains in `results/usability/`. `verify_synthetic_data.py` checks synthetic PDF datasets and legacy JSON datasets in QA artifacts.
