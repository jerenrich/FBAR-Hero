# PDF.js + custom XFA writer: measured results

26 September 2026. Tested PDF.js 6.3.289, pdf-lib 1.17.1, Chrome 154.0.8037.58, and independent pypdf 6.10.0/XML parsing. All records were invented; no personal PDF was sent to a service and no filing was submitted.

Update: the [Adobe handoff test](fbar-reader-handoff.md) now resolves the visible birthday export gap with a checksummed XFA saved-state packet. Two dates passed native Reader DOB validation, save/reopen and independent data comparison. Writer downloads in the table app include this fix. PDF.js's blank-DOB preview and native-save defects below remain.

**This combination works for table-driven unsigned drafts and dynamic preview. It does not yet meet the complete browser-only FBAR filing requirement.** The custom writer preserves the data and official template; PDF.js lays out repeated account sections. PDF.js does not execute the tested form's signing, validation or add-instance scripts. Its native save path also loses XML namespaces in this fixture and does not synchronize the unbound date-of-birth field.

The runnable [local experiment](../prototype/pdfjs/index.html) includes nine account columns, a date-of-birth input, add-account, regeneration, preview and unsigned draft download. Start it using the [prototype instructions](../prototype/README.md). It deliberately uses synthetic fixtures. This is a bounded compatibility experiment, not the full app or prior-year importer.

## Results

| Test | Result |
|---|---|
| Write 1, 3, 20 accounts with custom writer; open in PDF.js | 7, 7, 13 dynamically laid-out pages |
| Edit the table and add four accounts | 24 accounts, 14 preview pages |
| Download the 24-account draft; independently parse its XFA | All 209 populated values match namespace-qualified input paths |
| Leading-zero account number and zero maximum value | `00000042` and `0` preserved |
| DOB changed in the table | `02031981` correctly stored in the bound dataset |
| Original blank PDF and template | Original bytes remain an exact prefix; template packet unchanged |
| Click embedded Sign, Validate, + | No signing dialog, validation action or account addition observed |
| Enable PDF.js's own scripting manager | No field objects or document actions; manager does not become ready |
| Edit a bound institution field, then native PDF.js save | Text is saved, but business XML namespaces are removed |
| Edit visible DOB, then native PDF.js save | Display accepts the edit; bound DOB remains the previous value |
| Native `saveDocument()` without edits | Throws `Cannot read properties of null (reading 'get')`; use `getData()` for unchanged bytes |
| Offline native edit/save | Zero requests during this phase |
| Entire test | Zero external requests; assets served from loopback |

Evidence: browser results (generated locally at `prototype/results/pdfjs/results.json`), independent comparisons (generated locally at `prototype/results/pdfjs/independent-verification.json`), and table screenshot (generated locally at `prototype/results/pdfjs/table-editor.png`). The tests assert both the custom writer's successful round trip and reproduction of the native-save failures. A passing test therefore does **not** mean native PDF.js export is acceptable.

## Why dynamic pages work but signing does not

The writer updates `xfa:datasets/xfa:data` in the original PDF with repeated `FinAcctOwnedSeparately` records. PDF.js binds those records to the official template's repeated Part II subform and lays out the resulting pages. Our code does not copy static PDF pages. These are runtime XFA pages; the original PDF's static fallback page is not a flattened copy of the rendered form.

The form's buttons depend on XFA JavaScript, instance managers and Adobe host APIs. PDF.js's XFA button implementation handles limited navigation behavior, and its XFA layer attaches value-storage listeners; neither supplies the required FBAR event execution in this experiment. Enabling the PDF.js scripting manager did not resolve it. See the version-pinned [XFA template implementation](https://github.com/mozilla/pdf.js/blob/v6.3.289/src/core/xfa/template.js), [XFA HTML layer](https://github.com/mozilla/pdf.js/blob/v6.3.289/src/display/xfa_layer.js), and [scripting manager](https://github.com/mozilla/pdf.js/blob/v6.3.289/web/pdf_scripting_manager.js).

The DOB is a concrete example: the visible field is unbound, and a form script copies its value to the bound XML field. Editing the visible field alone leaves the submitted-data field stale. Country selection and page counters also depend on initialization/events. The preview has blank country selections, a blank visible DOB despite a populated dataset, missing counters and font/layout defects. Correct XML alone does not establish a faithful visible form.

Native PDF.js save serializes this dataset without its business namespaces. The root changes from `{http://www.fincen.gov/bsa/ffbar/2011-06-01}BSAForm` to unqualified `BSAForm`; other namespaces are also lost. All 177 expected populated paths consequently fail the qualified comparison, even though many strings survive. Well-formed XML and local-name-only comparisons would miss this defect. We do not infer a government acceptance result from it; it is already sufficient to reject native save for our data-preservation requirement.

## Implementation decision

Keep the table's canonical data model authoritative. Generate exports from the clean official template with our incremental writer. Treat PDF.js as a preview component, disable editing in a production preview, and never use its native save to create the filing artifact. The lab retains a clearly labeled diagnostic export solely to reproduce its limitations. Draft download regenerates from current table values so unapplied edits are included.

The table-to-writer route avoids the namespace and DOB data-save defects. It does **not** implement official signing, field synchronization, validation, saved form state or filing qualification. Setting a `Signed` flag ourselves would not establish those behaviors. Completing them without a commercial engine requires a separate, substantial implementation and compatibility effort. The earlier [Foxit experiment](fbar-export-feasibility.md) remains evidence of a working native-event path, with its own licensing and support dependencies.

A practical free alternative is browser preparation followed by final review, validation, signing and saving in Adobe Reader. That keeps personal processing on the computer but relaxes the browser-only requirement. This experiment has not verified that handoff or Reader usage rights. Preserve that distinction in the product promise.

For prior-year import and export comparison, parse the PDF's XFA datasets directly into the canonical table model, preserving namespaces and repeated-node indices. Do not extract from rendered text. Import only data into a clean current template; do not reuse old signing state. Independent verification here is Python-based development tooling; a production independent comparator must also run in the browser. Parts III–V, nested owners and other branches remain untested in this PDF.js experiment.

## Cost and local processing

PDF.js has no paid SDK license fee under [Apache 2.0](https://github.com/mozilla/pdf.js/blob/v6.3.289/LICENSE); pdf-lib is [MIT licensed](https://github.com/Hopding/pdf-lib/blob/v1.17.1/LICENSE.md). Engineering, maintenance and distribution-license compliance remain project work. These licenses do not supply a complete XFA runtime.

The lab bundles assets from local packages through a loopback-only static server. PDF parsing, XML edits, layout and writing run in the browser; the server exposes no document-processing or upload API. Browser tests abort non-loopback requests and record zero external requests. That demonstrates the measured flow, not a completed production privacy audit. No commercial SDK is used by this experiment.
