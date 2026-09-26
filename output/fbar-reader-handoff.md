# Adobe handoff test

**Update:** the [local workflow report](fbar-local-workflow.md) supersedes the remaining-work status below. It records a successful Reader signing check, local import/comparison, full catalog tables and representative native branch round trips.


We are evaluating a free browser table editor with final review, validation, signing and saving in Adobe Reader. The installed Adobe application reports `app.viewerType = Reader`, version 26.002.21901, in the native automated test.

## Current status

**Birthday export is fixed for the tested Reader handoff and enabled in the table app.** The writer now supplies a checksummed saved-state packet for the otherwise unbound visible DOB. Both January 2, 1980 and February 3, 1981 appeared automatically, passed the original DOB field validation, and survived native save and reopen. Both files retained all 177 populated input values and the original template; Reader generated 13 pages for 20 accounts.

Computer validation is now available: macOS reports Accessibility enabled, application-window screenshots work, and Adobe's native scripting API responds. The test targets synthetic documents explicitly by filename, reads the visible and bound DOB, executes the original DOB validation, saves locally and reopens. No date was typed or assigned through Adobe to obtain these results. No macOS security settings were changed, and no signing or submission was performed in this test.

Evidence: native Reader round trips (generated locally at `prototype/results/dob-state/adobe-roundtrip-results.json`), browser generation and checksum controls (generated locally at `prototype/results/dob-state/browser-results.json`), and independent packet checks (generated locally at `prototype/results/dob-state/independent-verification.json`). The focused Adobe screenshot was inspected and shows the restored DOB.

The subsequent [quality review](fbar-quality-review.md) also fixed filer and Part II country/state initialization. UK, US/California and Canada/Ontario filer fixtures passed the original pre-sign validation and unsigned save/reopen checks. State is intentionally blank and disabled for UK addresses. Final signing, other account branches, Reader usage-rights signature verification and filing acceptance remain unverified.

## Manual pass

Use `prototype/results/browser-incremental-20.pdf`, whose filing name is **SYNTHETIC TEST ONLY DO NOT FILE**. Do not use the native PDF.js diagnostic exports. Do not upload any synthetic PDF or click Ready To File.

1. Open the draft in the desktop Adobe application. Record any unsupported-form, disabled-function or usage-rights warning verbatim. Stop on such a warning rather than changing security settings.
2. Check that all 20 accounts appear, with account numbers `0000TEST001` through `0000TEST020`. The browser preview produced 13 pages; record Adobe's actual page count rather than assuming it is identical.
3. For current birthday/address fixes, use a newly generated writer download; the older `browser-incremental-20.pdf` remains the unfixed control. DOB should display **01/02/1980** (January 2, 1980) without typing it. United Kingdom should display as the country, with state blank and disabled. Record any mismatch before manually repairing it.
4. Use the form's own Validate and Sign the Form buttons. If the form reports errors, record the message before correcting it. This is a synthetic QA signing exercise only, using invented identity data. Do not use a generic Acrobat signature overlay.
5. Save a new local file as `prototype/results/adobe-finalized-20.pdf`, preserving the original draft. Close only that test document, reopen the saved file, and check account count, visible DOB and signing state again. Avoid printing to PDF or flattening it.
6. Run the independent comparison:

```sh
python3 prototype/scripts/verify_reader_handoff.py prototype/results/adobe-finalized-20.pdf --output prototype/results/adobe-handoff-verification.json
```

The verifier checks 177 populated namespace-qualified input values, 20 account records, original template, saved form state, visible DOB and signing markers. It has positive and negative controls using existing synthetic fixtures. A pass verifies those data/state properties only; it cannot certify a signature, Reader usage rights, visible layout or government acceptance.

## After the handoff passes

Build the prior-year local XFA importer and complete the spreadsheet fields, keeping imported data separate from prior signing state. Add export/re-import comparison inside the browser. Expand tests to joint ownership, signature authority, consolidated reports, preparers and other applicable branches. Retain the deliberate final Adobe review/sign/save step in the product flow.

## Birthday export experiment

The custom writer has a `restoreUnboundDob` option, enabled by the table app. It restores `BSAForm.Part1.DobLastSub.dob` using the date from the namespaced data record. The app also enables `restoreFilerAndPartIIAddresses`, which restores address choice lists and state requirements in the same checksummed XFA `form` packet. It updates the AcroForm packet list incrementally. It does not change the official template or copy any signing state, locks or previous form instances. With only the DOB option enabled, empty DOB produces no form packet; invalid calendar dates are rejected.

The first candidate omitted the XFA form checksum and the user reported a blank DOB. The corrected implementation hashes a normalized lexical representation of the template followed by the datasets using XFA's legacy SHA-1/base64 convention. It reproduces the checksum in two existing runtime-saved control PDFs exactly. This checksum is an integrity mechanism for saved form state, not a filing signature. The historical [PDFium implementation](https://pdfium.googlesource.com/pdfium/+/e1a41afbe146c9a976d96828a3a09a8a384741d9) provided the normalization behavior; this is not ordinary W3C canonical XML.

Tests generated original-date, changed-date and empty-date candidates offline, rejected February 30, confirmed the writer's default (option off) output remains byte-identical, and independently checked exact datasets and preservation of every other original packet. PDF.js still renders 13 pages with blank visible DOB because its preview does not restore this saved state; Adobe restores it correctly. The app describes this preview limitation. Reproduce with:

```sh
node prototype/scripts/dob-state-test.cjs
python3 prototype/scripts/verify_dob_state.py
python3 prototype/scripts/adobe_dob_test.py
```
