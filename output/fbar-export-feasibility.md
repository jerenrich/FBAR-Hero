# Browser FBAR export: feasibility resolution

26 September 2026. This report supersedes the original specification's unresolved browser-engine question.

Update: the separate [PDF.js + custom writer experiment](fbar-pdfjs-feasibility.md) now demonstrates a free local table/draft/preview path, with measured native-save and signing limitations. The signing results below apply to Foxit only.

**The core browser workflow is technically feasible.** A synthetic 20-account FBAR was populated, dynamically rendered as 13 pages, signed through the form's original acknowledgment, saved offline, reopened and saved again. An independent parser confirmed all 177 populated input values, 20 repeated account instances, the visible date of birth and saved signing state. The official template bytes remained unchanged.

The recommended implementation is a spreadsheet UI plus a locally hosted **Foxit PDF SDK for Web with dynamic XFA**, an incremental PDF data writer, and an independent importer/comparator. This is a demonstrated prototype route, not a completed app or a certification that FinCEN will accept its output. Commercial licensing and a supported widget-integration interface are production dependencies.

## What was actually tested

Only the public blank government PDF and invented records were used in the browser SDK demo. The user's completed PDF was not passed to the demo. No report was submitted to FinCEN.

| Test | Result |
|---|---|
| Browser-only data writing for 1, 3 and 20 separately owned accounts | Passed with network disabled and zero requests during writing |
| Independent parse of those three PDFs | 25, 41 and 177 populated expected values matched respectively |
| Open the 20-account PDF in an XFA browser engine | 13 generated pages; account instances 1–20 present |
| Synchronize date of birth and country-dependent requirements | Passed through native XFA widget events |
| Original Sign button and acknowledgment | Executed; the synthetic acknowledgment was accepted in the test only |
| Signing and saving with browser network disabled | Passed after preloading the SDK's lazy save module |
| Independent parse of signed output | All 177 populated inputs matched; `Signed=1`, timestamp present, 20 Part II instances, visible DOB retained |
| Reopen signed output in a fresh browser session, then save again | 13 pages; signing state and all 177 populated inputs retained |
| Original PDF bytes and official template | Original PDF remains an exact prefix; decoded template unchanged in all five final test files |
| Government upload or Adobe Reader rights verification | Not performed |

The browser was Chrome 154.0.8037.58 in the local test environment; the exact runtime version is recorded in the JSON evidence. The independent parser was pypdf 6.10.0 with Python's XML parser. The signed fixture covers an individual with a UK address and 20 Part II accounts. It does not establish complete coverage of Parts III–V, preparers, amendments or the 25-or-more branches.

Evidence: independent comparisons (generated locally at `prototype/results/independent-verification.json`), offline writer results (generated locally at `prototype/results/browser-packet-results.json`), engine run (generated locally at `prototype/results/final-engine-test.json`), and values read from the reopened runtime (generated locally at `prototype/results/final-reopen-test.json`). Test PDFs are synthetic engineering fixtures, never filing documents.

## Why this engine resolves the page-generation problem

The supplied PDF is dynamic XFA, not a conventional collection of fillable AcroForm fields. The official template binds repeating subforms to repeated XML account elements. Its XFA engine creates instances and paginates them. With the test's 20 separately owned accounts, the runtime placed three account blocks on most Part II pages and produced 13 pages overall, including the other form sections.

Foxit's Web SDK includes WebAssembly modules for dynamic XFA layout and scripting. These capabilities require the appropriate licensed features. [Foxit modules and setup](https://developers.foxit.com/documents/development-guide/pdf-sdk-web/getting-started.html), [Web SDK product](https://developers.foxit.com/products/web/).

The SDK documents `importXFAFromFile`, `exportXFAToFile` and PDF saving. The tested export returned a wrapper containing a Blob, so normalize the actual SDK return type in the pinned adapter. After import, the existing viewer's page count could stay at seven; reopening the saved bytes produced the correct 13 pages. Treat save-and-reopen verification as part of the export transaction. [PDFDoc API](https://webviewer-demo.foxit.com/docs/API_Reference/html/class_p_d_f_doc.html).

The standard `pdf-lib` form API is unsuitable for this form. The prototype uses its low-level parser only, then appends a replacement XFA `datasets` stream and a cross-reference stream. It never calls `getForm()` or clones ordinary PDF pages. The writer accepts only the exact recognized public blank template and refuses a completed PDF containing saved form state. [pdf-lib XFA limitation](https://pdf-lib.js.org/docs/api/classes/pdfform#hasxfa).

## Two defects the adapter must handle

**Date of birth has two representations.** `FilerInformation/DOB` is encoded as `MMDDYYYY`, but the visible `BSAForm.Part1.DobLastSub.dob` field is unbound. Its validation script clears the bound value if the visible field is empty. Both XML import and a data-packet-only update initially lost the DOB when the runtime processed the form.

The working adapter locates the visible widget by its full XFA name, enters `MM/DD/YYYY` through its native input events, then removes focus so the official exit/validation scripts run. The final signed and reopened PDFs retain both representations. A handwritten minimal `form` packet, with and without an experimental checksum, did not fix this in the evaluated engine; that approach was discarded.

**Country selection has dependent behavior.** Binding `GB` alone did not run the country field's exit script, leaving State required. Focusing and exiting `CountryIndividual` caused the original `StatesAndCountriesJS` functions to update State and ZIP requirements. The final test passed signing validation with a UK address and no state value. The template also rejected spaces in the synthetic postal code; the fixture uses `SW1A1AA`. Production input rules should explain any required formatting instead of silently changing user data.

These findings require an event-aware adapter, not just XML serialization. Extend its dependency handling and test every conditional branch before release.

**Integration constraint:** `getAllXFAWidgetsByPageIndex` and `triggerXFAWidgetEvent` were callable in the evaluated build but are internal SDK interfaces, not a verified public support contract. The prototype demonstrates the necessary mechanism using widget names and runtime rectangles rather than browser screen coordinates. Before shipping, obtain a supported equivalent from Foxit or explicit support for a pinned SDK build. Merely buying a base PDF viewer license does not establish this requirement.

## Production flow

1. Import a previous local PDF by parsing its XFA datasets as data, without running that uploaded document's scripts. Convert it to the versioned Filing, Accounts, Owners and Preparer tables.
2. For a new year, clear annual values and signing data; retain only the user's selected reusable information.
3. Serialize the reviewed table into the current official blank template's namespace-qualified datasets. Keep the original template and scripts intact.
4. Open those bytes in the bundled XFA runtime. Let it create the repeated instances and pages, then synchronize unbound controls and run dependent field events.
5. Run the form's validation and present the original signing acknowledgment. A real user must explicitly accept it. The app must not set `Signed=1` directly or automatically accept a real user's acknowledgment.
6. Save the interactive PDF incrementally. Reopen the saved bytes, verify the layout and signing state, and compare the data against the table. Block final download on unexplained differences.
7. Let the user save the final PDF and upload it manually through the government site. Do not activate the form's Ready To File button from application automation.

Signing's built-in validation was exercised by the test. The standalone Validate button is disabled after signing; clicking it then is not an additional validation test.

## Local-processing design

Bundle the SDK, XFA/layout/save WebAssembly modules, workers, fonts, styles and application code. Warm all required modules using a blank or synthetic fixture before accepting personal data. Remove every demo analytics, cloud-signature, upload and remote-font integration. Do not embed or redirect users to the public SDK demo.

Foxit's runtime uses a service worker for synchronous communication between its workers and UI. Requests to `__foxitwebsdk-syncmsg__` can appear in developer tools even though the service worker handles them locally. During the offline signing/save test, all six recorded responses came from the service worker; none came from the network. This is evidence about that test, not a completed audit of a production build. [Foxit service-worker integration](https://webviewer-demo.foxit.com/docs/developer-guide/main/skills/integrate-service-workers.html).

The earlier blanket `connect-src 'none'` recommendation needs revision because it can interfere with this messaging mechanism. Use a tightly scoped, tested policy; require service-worker control before processing documents and fail closed if it is lost. For the strongest initial delivery, serve the downloadable static app from a loopback-only local launcher. The launcher serves bundled assets and performs no PDF or personal-data processing. Even a failed local messaging request then cannot reach an external host. A hosted PWA remains possible, but its service-worker failure and network policy must be audited separately.

Keep user data in memory by default. Explicit local JSON draft downloads and optional encrypted local drafts are sufficient. No telemetry, remote logging, account service or backend processing is needed. An independent re-import/comparison module must also run in the browser; Python is used only as a different implementation for prototype verification.

## What remains before a filing product can ship

- Obtain the Web SDK/XFA license and a supported widget bridge. Pin the runtime and blank-template fingerprints and reject untested changes.
- Finish the user-facing spreadsheet, complete all conditional adapters, and test mixed account categories, nested owners, reporting modes, amendments and preparer fields.
- Bundle appropriate fonts and finish visual qualification. The demo rendered the account data legibly but showed overlapping account-counter labels and some footer text; local font access was declined during testing. This is a measured rendering limitation, not a visual pass for production.
- Verify Reader extension rights and Adobe compatibility after the final save. Preserving the original bytes and template is useful evidence, but does not prove a `/UR3` signature remains valid. Local Adobe automation could not be completed because macOS denied assistive access and an Apple-event script timed out.
- Confirm filing-format compatibility through the applicable FinCEN support/test process, without submitting synthetic reports to production. FinCEN currently directs PDF filers to Adobe Reader. [FinCEN filing methods](https://bsaefiling.fincen.gov/file/fbar), [PDF filing procedure](https://bsaefiling.fincen.gov/resources/FBAR_EFILING.pdf).

These are concrete product qualification tasks. The former uncertainty about whether a browser can execute this form's dynamic layout and signing workflow has been replaced with a working synthetic demonstration and identified integration requirements.

## Implementation artifacts

- [Application specification](fbar-app-specification.md)
- [Logical spreadsheet column dictionary](fbar-field-dictionary.md)
- [129-field catalog with qualified XML paths](fbar-field-catalog.json)
- [Prototype instructions and test scope](../prototype/README.md)
- [Browser incremental XFA writer](../prototype/xfa-packet-writer.mjs)
- [Experimental XFA event adapter](../prototype/foxit-xfa-adapter.mjs)

Public blank used for the test: the Prepare FBAR link on FinCEN's filing page, downloaded as `official-blank.pdf`, 152,885 bytes, SHA-256 `21b8aed683a7a770dc7cba65ec6d4221fe7c1be50040786d894d02e34fbd571b`. This fingerprint differs from the user's completed 2023 file; the prior-file importer and current-blank exporter are deliberately separate adapters.
