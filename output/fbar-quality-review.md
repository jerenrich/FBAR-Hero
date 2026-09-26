# FBAR prototype quality review

**Update:** the [local workflow report](fbar-local-workflow.md) supersedes the remaining-work status below. It records a successful Reader signing check, local import/comparison, full catalog tables and representative native branch round trips.


Reviewed September 26, 2026 using invented records and the public blank template. No personal PDF was used in these QA runs, and nothing was submitted.

## Changes

- **Country and state restoration:** the original country dropdown values include padding, so a canonical dataset code could fail to select its label. Its country exit script also initializes state choices and requiredness; data binding alone did not do this. The writer now restores normalized country/state choices and country-dependent state requirements in its checksummed saved-state packet. The official template remains unchanged. This support covers filer and Part II addresses.
- **Preview editing:** the normal PDF.js preview is read-only. Previously its editable fields could suggest changes would be exported even though the writer uses the table. PDF.js's lossy native export is now available only under `?diagnostics=1`. The table remains the editable source for writer downloads.
- **Input checks:** account values must be whole dollar strings, required fields must be present, official field lengths are checked, and the supported type codes are A, B and Z. Other accounts require a description. The editor checks the template's ASCII constraint. Zero values and leading zeros are preserved. Overlapping table operations are prevented while export/rendering runs.
- **Local server:** malformed URLs no longer throw uncaught decoding errors. Request methods, host headers and path containment are checked, and browser policy headers restrict external connections and embedding.
- **Synthetic data:** invented values now use only ASCII letters, digits and spaces, including negative-test values. Older affected PDFs and screenshots were removed or replaced. The generator rejects noncompliant invented values, and a separate checker scans the business datasets in fixture/result XML and PDFs. The lasting rule is in [AGENTS.md](../AGENTS.md). Official template/code lists, required metadata and date/serialization syntax retain their required formatting.

## Verification

The regenerated UK, US/California and Canada/Ontario filer fixtures each opened as 13 pages in desktop Adobe Reader. The visible DOB and country/state labels were correct. The original form's pre-sign validation returned true with no errors or warnings. After native unsigned save and reopen, all populated input values matched independently: 177 for UK, 178 each for US and Canada. Template bytes were unchanged. Account addresses in these fixtures were UK addresses.

This pre-sign check executes the original validation with the form's signing-validation flag temporarily enabled, matching its pre-sign validation mode. It does not click through the signing acknowledgment or create a signature. A separate signing attempt did not produce a verified signed save; end-to-end Reader signing remains unverified.

Browser tests covered three valid and three invalid address cases, eight server request cases, six invalid table input cases, the read-only preview, and hidden diagnostic export. The downloaded three-account draft independently preserved the account's leading zeros, zero maximum value and plain institution name. External requests were blocked; none occurred during these browser workflows. Address generation also ran offline.

Evidence:

- Adobe validation and round trips (generated locally at `prototype/results/audit/adobe-address-results.json`)
- Address generation checks (generated locally at `prototype/results/audit/address-browser-results.json`)
- UI and request-handling checks (generated locally at `prototype/results/audit/ui-results.json`)
- Independent table-download check (generated locally at `prototype/results/audit/ui-independent.json`)
- Synthetic data policy check (generated locally at `prototype/results/audit/synthetic-data-policy.json`)

## Remaining work

The app is still a synthetic feasibility prototype. It needs the complete filer editor, prior-year local import, in-browser independent export comparison, and equivalent coverage for Parts III–V, nested owners and preparers. PDF.js's approximate preview still does not restore the saved DOB/address state; Adobe is the checked handoff runtime. Country changes made later inside Reader, other address/account branches, final signing, Reader usage rights and filing acceptance require further qualification.
