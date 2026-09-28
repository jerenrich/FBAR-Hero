# FBAR Magician local workflow

The local app now supports a blank draft, completed-PDF import, filer/account/owner/preparer tables, explicit save/resume of unfinished work, undo, year rollover, verified unsigned export, and comparison with a saved PDF. Open the existing local server at `http://127.0.0.1:3141/`; refresh an older tab after saving any work in it.

## Using the app

1. Choose **New blank draft** or **Open FBAR** to continue a saved PDF or reuse a completed one. Opening reads the file locally, checks its template, and copies business data into a fresh unsigned draft. It preserves the source year and balances for review. Your original PDF is unchanged. Completed imports show the detected year and account counts, with choices to continue that year or prepare another year.
2. Edit filer information and the applicable account tables. Joint accounts include a principal joint owner; signature authority and consolidated accounts support repeated owners. The catalog supplies all 124 non-system field mappings. Enumerated fields use labeled dropdowns; longer selected labels wrap below filer and owner controls. Checkbox fields distinguish blank from checked. The date of birth also appears with its month spelled out.
Use **Save PDF** at any point, including when fields are incomplete or invalid. The save dialog explains that the downloaded PDF is unencrypted and includes sensitive personal and financial data, and warns about shared devices and cloud-synced folders. Check that the download finished and keep it in a private location. **Open FBAR** reopens it locally. No automatic copy is kept.

3. To reuse the accounts for another year, enter the target year and use **Change year & clear annual values**. This clears maximum balances, unknown-value flags, amendment details and late-filing explanations. The confirmation lists the account count and cleared values. **Undo** restores the previous state; it also restores removed accounts and owners. Review account membership and every year's values.
4. Choose **Check & download unsigned draft**. The app writes into the trusted blank PDF, parses the resulting PDF again, and compares its namespaced business values and repeated-record counts with the table. It also checks the separately saved visible birthday, so a matching hidden DOB with a missing visible value fails comparison. A mismatch stops the download. The PDF remains dynamic and interactive.
5. Open the draft in Adobe Reader, review it, use the form's original Validate and Sign controls, and save it. Use **Compare a saved PDF** to check the saved business data against the still-open table. Comparison deliberately excludes final signature date/attestation fields; it does not certify a signature or filing acceptance. Upload the final PDF yourself through the government workflow.

The optional PDF.js preview is read-only and approximate. It still does not restore all saved-state presentation, including the birthday. Adobe is the tested rendering/signing handoff. Imported PDFs are never rendered directly by the app: only a newly generated draft using the trusted template is previewed.

All document processing occurs in the browser. No upload endpoint, analytics, external document service, localStorage or sessionStorage is used. The loopback server serves static assets. The browser tab holds the editable draft in memory; save a PDF before closing or refreshing it. Open saved PDFs with **Open FBAR**. Older JSON work files also open there for migration. The app cannot confirm completion of a browser download. A saved file may be accessible to others or synced by software outside the app; the save dialog makes that risk explicit.

The sticky action bar shows year, account count and unsaved changes. Account addresses and owners are in expandable details; narrow screens use stacked cards. Unused empty conditional fields are hidden, while populated fields stay visible for review. Validation errors link to exact fields, open their sections and show section issue counts. Starting or importing another draft protects unsaved edits. Successful PDF export displays the Reader completion checklist separately from the data comparison result.

## Import and comparison boundaries

- Data-only import accepts an XFA packet-array PDF with the tested template or a compatible variant with identical binding definitions, FBAR version 1.0.2 and the supported business schema. Exports and exported-PDF verification still require the exact trusted blank template. Changed bindings, unsupported data versions, flattened/scanned files and unsupported/encrypted structures are rejected. The file limit is 25 MB, with an 8 million character XML limit.
- Imported templates and JavaScript are not executed or copied. Namespace/schema mismatches, unknown fields and duplicate singleton fields stop import without replacing the current table.
- Prior form state, signing/locking markers, signature date, attestation, submission URL and runtime form counts are not copied into a new draft. Website contact information and recognized prior PDF viewer/session metadata are excluded with notices; they are not part of the FBAR table editor. Unknown extra records remain rejected. Dropdown code padding is removed with a notice.
- Numeric identifiers and dollar values remain strings. Unknown balances are explicit checkboxes. The comparison catches changed values, missing populated fields, extra populated fields and changed repeated-record counts. Missing versus empty optional leaves are treated as equivalent.
- Input validation checks catalog lengths/enums, basic requiredness, whole-dollar values, owner fields and address choices. It is not a complete replacement for the official form's conditional validation.

## Verified results

The native Adobe Reader test accepted the original **I acknowledge that I am electronically signing the BSA report** dialog for a synthetic 20-account writer draft. Its signed flag, timestamp, birthday and all 177 populated input values survived save/reopen. The saved form passed its original validation, and the template bytes were unchanged. A focused screenshot showed the signed/locked form. Nothing was submitted. Signing evidence (generated locally at `prototype/results/audit/adobe-signing-results.json`).

The new local browser workflow imported that signed PDF, displayed all 20 accounts and the correct birthday, removed signing state from its fresh export, and matched the saved input data. Negative controls detected changed/missing/extra data and a missing visible DOB even when the bound DOB matched. The UI displayed a comparison failure. Owner add/remove controls were also exercised. Unknown-field import was rejected. Rollover cleared balances while preserving account identifiers. Browser workflow evidence (generated locally at `prototype/results/workflow/browser-results.json`).

The expanded branch fixtures passed native pre-sign validation, unsigned save and reopen:

| Fixture | Native pages | Populated values preserved | Additional checks |
|---|---:|---:|---|
| Joint account, signature authority with two owners, self-employed preparer | 8 | 74 | Visible DOB; US/California joint owner; Canada/Ontario second authority owner; UK preparer; unknown account maximum |
| Consolidated report with two owners | 8 | 39 | Canada/Ontario second owner; entity filer without DOB |

Both retained the original template. Native branch evidence (generated locally at `prototype/results/workflow/adobe-branch-results.json`). These are representative branch checks, not every possible reporting combination.

The native checks caught a blank-template `xfa:dataNode` hint that Reader removed before evaluating saved-state integrity. Keeping that hint made the imported draft's visible birthday and address choices blank. The new draft builder removes it before hashing, and the regenerated branch fixtures restored those fields and passed validation.

The existing 1/3/20-account PDF.js rendering tests still produced 7/7/13 pages; the 24-account edited draft produced 14 pages and independently preserved 209 populated values. Native PDF.js diagnostic saves remain unsuitable; their expected failures are recorded separately. Server/input regression tests passed. Browser import/export/comparison ran offline after local assets loaded, with external requests blocked and none observed. Synthetic fixtures comply with [AGENTS.md](../AGENTS.md).

## Usability verification

`usability-test.cjs` verifies exact incomplete-value and repeated-owner save/resume round trips, including invalid enum values; explicit privacy disclosure and cancellation; save-before-replacement checks; undo after deletion and rollover; validation links that focus the correct repeated record; conditional fields; import year choices; and the separate Reader completion checklist. Desktop and 390-pixel layouts passed in light and dark browser preferences, with no page overflow. The tests observed no external requests, localStorage entries or sessionStorage entries. Results and screenshots (generated locally at `prototype/results/usability/results.json`).

Startup safeguards, compatible import rejection, the complete offline account/owner/preparer workflow, existing UI regression checks, server/input checks and independent exported-PDF verification also passed. The synthetic-data policy checker now examines work-file JSON datasets as well as XML and PDF fixtures; all 56 checked datasets passed. No native signing flow was changed or rerun for this usability update.

## Limits and further qualification

Reader signing is verified for the 20-account synthetic writer fixture above. A later automation attempt to repeat signing on an imported draft was unreliable when multiple Adobe documents and modal dialogs were active; it did not yield a second verified signed artifact. The branch results above are unsigned native validation/save checks. Use the normal desktop acknowledgment flow, rather than programmatic signing, in the product.

The exact template restriction on exports remains deliberate; compatible prior templates can be imported as data only. A production release needs a template update/version policy, more country/territory and reporting-branch combinations, broader browser/Reader coverage, and review of Reader usage rights. No government acceptance test or filing submission has been performed.

## Reproduce

From the repository root, with the dependencies described in `prototype/README.md`:

```sh
node prototype/scripts/local-workflow-test.cjs
node prototype/scripts/usability-test.cjs
python3 prototype/scripts/adobe_branch_test.py
node prototype/scripts/audit-ui-test.cjs
python3 prototype/scripts/verify_audit_ui.py
python3 prototype/scripts/verify_synthetic_data.py
```

`adobe_signing_test.py --prepare` creates an isolated synthetic signing candidate. Complete its original acknowledgment in Reader, then run `--verify` to check save/reopen data and state. Never use Ready To File with test data. Desktop scripts target synthetic filenames only and never submit anything.

## Prior-form import correction

The supplied 2023 PDF used a compatible template variant: all 321 binding definitions matched, but template bytes differed. Its saved datasets also contained recognized PDF viewer/session metadata, both alongside and inside the business record. Import now checks compatibility and excludes those metadata fields explicitly. Local browser verification checked all 79 populated input values against the original, allowing documented dropdown-padding normalization, with no differences. The in-memory unsigned export comparison also passed; no personal artifacts were saved and no external requests occurred. Whitespace-only dropdown selections are treated as blank, and padded known option codes are normalized without trimming free-text values. Synthetic regression coverage is in `compatible-import-test.cjs` and its results (generated locally at `prototype/results/compatible-import/results.json`). File inputs reset after errors so the same PDF can be selected again.
