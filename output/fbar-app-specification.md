# FBAR Magician: product and technical specification

Prepared 26 September 2026; updated after the browser feasibility prototype. Scope: application specification, PDF analysis and synthetic export tests. A full user-facing app has not been built; nothing has been submitted.

**Recommendation:** build a local browser table editor with a self-hosted Foxit PDF SDK for Web XFA runtime, an incremental XFA data writer and an independent PDF comparison module. The synthetic prototype demonstrates dynamic layout, the official signing acknowledgment and offline saving. The 20-account signed PDF retains all 177 populated input values. Production work still includes licensing, a supported widget API, full form-branch coverage and filing-format qualification. See [the feasibility resolution and evidence](fbar-export-feasibility.md).

The supplied document was inspected locally with Python and pypdf. Its scripts were read as source, not executed. The original was not changed. The accompanying specifications contain field metadata, not the submitted names, tax identifiers, account numbers or balances. Only public technical and government documentation was searched online. Subsequent SDK experiments used the current public blank template and invented records, never the supplied personal PDF.

## 1. Requirements and feasibility

| Requirement | Design and current confidence |
|---|---|
| Spreadsheet-like entry | Feasible. Keyboard navigation, rectangular paste, dropdowns, inline errors, fill down, duplicate rows and undo. |
| Parse a previous FBAR PDF | Confirmed for the supplied dynamic XFA format: values and repeated records are available as structured XML. No OCR is needed for this file. |
| Keep all personal-data processing in the browser | Feasible for import, editing, validation, comparison and draft storage. Bundle every dependency locally; no application server receives documents or values. |
| Fill the PDF and add sections using its existing functionality | Demonstrated with Foxit Web XFA: 20 synthetic Part II accounts reopen as 13 dynamically generated pages. The engine runs the official template; ordinary page cloning is unnecessary. |
| Download a completed PDF for manual upload | Must preserve an interactive, compatible government PDF and complete its signing workflow. A PDF whose XML reads back correctly is not sufficient evidence of readiness to file. |
| Validate output against the input table | Feasible as a local semantic comparison. Also needs separate runtime/layout checks and verification of filing compatibility. |

FinCEN currently identifies Adobe Reader as required for its PDF filing route. Its separate online form is a different workflow. [FinCEN filing methods](https://bsaefiling.fincen.gov/file/fbar).

The selected implementation runs preparation, dynamic layout, validation, signing acknowledgment and saving in the browser. The browser SDK needs its commercial XFA capability. Its public demo was used only to establish feasibility with synthetic data; it must never be embedded as the personal-data editor.

Use a clean official template for export. Run the XFA widget events that synchronize unbound fields and conditional requirements, then present the official acknowledgment for the user's deliberate signing action. Save incrementally, reopen and compare before offering the final download. Do not automatically click an acknowledgment on a user's behalf.

The prototype's widget bridge is an internal SDK interface, so its vendor-supported equivalent or contractual support for a pinned build is a production dependency. Adobe finalization remains an optional fallback, not the selected browser workflow. FinCEN acceptance and Reader-extension validity remain separate qualification checks; a successful browser test is not government certification.

## 2. What the attached PDF actually contains

| Observation | Evidence from the file |
|---|---|
| PDF file size | 217,514 bytes |
| Stored ordinary PDF pages | One fallback page displaying “Please wait...” |
| Conventional AcroForm fields / page widgets | Zero / zero |
| XFA container | `/Root/AcroForm/XFA`, an array of packet-name / indirect-stream pairs |
| Dynamic rendering | `/Root/NeedsRendering = true`; config `dynamicRender = required`, `renderPolicy = client`, `scriptModel = XFA` |
| Template identity | Template default version `1.0.2`, filing type `FBARX`, specification default `0051`. Saved datasets have an empty specification-version value; do not infer schema compatibility from one field alone. |
| Template and saved state | `template` 595,644 decoded bytes; `datasets` 22,010 bytes; `form` 248,238 bytes |
| Other packets | XDP wrapper, `config`, `sourceSet`, `connectionSet`, `localeSet`, `xmpmeta`, closing XDP wrapper |
| Template controls | 238 field/exclusion-group nodes; 553 script nodes, including shared script libraries |
| Bound data paths | 129 distinct explicitly bound XML field paths, cataloged separately |
| Reader extensions | `/Root/Perms/UR3` usage-rights signature exists; its permissions include form fill, import, export, add/delete and template spawning |
| Existing signing state | The saved XFA `form` packet has `Header.ActionFields.Signed = 1` |

The supplied instance has three populated separately owned account records and two populated jointly owned records. It also contains empty Part IV and V scaffolding. An importer must distinguish these placeholders from actual accounts. The saved `form` packet has matching Part II/III instance counts, further confirming the relationship between repeated data and repeated form sections.

The static fallback page was rendered and inspected. A full Adobe/XFA rendering of the populated pages was not performed; ordinary Poppler rendering cannot validate their dynamic layout. No Adobe save/sign cycle or FinCEN acceptance test was performed.

The document's instructions and tooltips were used to understand its fields and behavior; they were not treated as instructions to sign, submit, contact a service or change the user's task.

## 3. How new sections and pages are generated

The template defines repeating, top-to-bottom subforms. Each binds to repeated sibling XML elements. The layout engine combines those instances with master-page areas and pagination rules.

| Form section | XFA subform | Data binding relative to `BSAForm` | Master-page area |
|---|---|---|---|
| Part II: separately owned accounts | `Part2` | `$.FinAcctOwnedSeparately[*]` | `Part2and3` |
| Part III: jointly owned accounts | `Part3` | `$.FinAcctOwnedJointly[*]` | `Part2and3` |
| Part IV: signature authority, no financial interest | `Part4` | `$.NoFinInterestFinAcctOwned[*]` | `Part4` |
| Part V: consolidated report | `Part5` | `$.ConsolidatedAcct[*]` | `Part5` |

Each of these subforms declares `<occur max="9999"/>`. Parts IV and V also contain independently repeating owner subforms:

- `Part4.section2` binds to `$.NoInterestAcctOwner[*]`.
- `Part5.section2` binds to `$.ConsolidateAcctOwner[*]`.
- Both declare a maximum of 9,999 instances. These template limits are not a performance guarantee or a substitute for current filing limits.

The Part II Add button executes this code:

```javascript
var part2 = _Part2.addInstance(1);
xfa.host.setFocus(part2.secHeaderSub.MaxAcctValue);
```

The other Add buttons use the same instance-manager mechanism, generally with explicit count guards and required-field highlighting. Delete buttons call `removeInstance(index)` and prevent removing the final instance. Count fields read `instanceManager.count`.

**Implementation consequence:** create the correct repeated XML records and let a compatible XFA runtime bind and lay them out, or drive the official instance managers inside such a runtime. Do not use `copyPages()`, clone a PDF page, or write text at coordinates. Page count is a layout result; nested owners and flowing content mean it should not be calculated as a fixed number of pages per account.

The browser cannot call `_Part2.addInstance()` simply by embedding the PDF. That name belongs to the XFA form runtime, not the web page's JavaScript environment.

## 4. Data model and logical spreadsheet columns

Use four linked tables. Start the UI on Accounts, with a compact Filing panel and expandable owner details. Users should not have to navigate the PDF to enter data.

All identifiers are strings, including account numbers, tax IDs, BSA IDs, phone numbers and postal codes. Preserve leading zeros. Use explicit nulls for absence, separate booleans for unknown values, and exact decimal/integer strings for money. Keep an internal immutable row ID; an account number alone is not a unique key.

**Filing — one row per report**

| Group | Logical columns |
|---|---|
| Report | `filing_id`, `filing_name`, `report_year`, `is_amendment`, `prior_report_bsa_id` |
| Filer classification | `filer_type`, `filer_type_other_description` |
| US identification | `tax_id`, `tax_id_type` |
| Alternative foreign identification | `foreign_id_type`, `foreign_id_other_description`, `foreign_id_number`, `foreign_id_issuing_country` |
| Name | `last_name_or_organization_name`, `first_name`, `middle_name`, `suffix`, `date_of_birth` |
| Address | `street_address`, `city`, `state_province`, `postal_code`, `country_code` |
| Account declarations | `financial_interest_25_or_more`, `financial_interest_account_count`, `signature_authority_25_or_more`, `signature_authority_account_count` |
| Other filing data | `late_filing_reason`, `late_filing_explanation`, `filer_title`, `third_party_preparer` |

**Accounts — normally one row per account**

| Visible label | Logical column | Relative account XML field |
|---|---|---|
| Account ID / filing link | `account_id`, `filing_id` | App-only keys |
| Ownership category | `ownership_category` | Selects Part II, III, IV or V record container |
| Record kind | `record_kind` | App-only: account detail or owner-only reporting group |
| Financial institution | `institution_name` | `FinInstName` |
| Account number | `account_number` | `AccntNumber` |
| Account type | `account_type` | `AccountType` |
| Other account type | `account_type_other_description` | `OtherDesc` |
| Maximum value, USD | `maximum_value_usd` | `MaximumAccntValue` |
| Maximum value unknown | `maximum_value_unknown` | `MaximumAccntUnkn` |
| Institution street address | `institution_street_address` | `Address/Address` |
| Institution city | `institution_city` | `Address/City` |
| Institution state/province | `institution_state_province` | `Address/State` |
| Institution postal code | `institution_postal_code` | `Address/ZIP` |
| Institution country | `institution_country_code` | `Address/Country` |
| Other joint owners, excluding filer | `joint_owner_count_excluding_filer` | `NOofJointOwners`, Part III only |
| Reviewed for this year | `review_status` | App-only |

Ownership categories: `separate`, `joint`, `signature_authority_only`, `consolidated`. The account-type dropdown is a different concept: bank, securities or other.

Optional calculation columns can be added later: `currency_code`, `maximum_value_local_currency`, `exchange_rate`, `exchange_rate_convention`, `exchange_rate_date`, `exchange_rate_source`. They are not fields in this PDF. The minimal version accepts the reportable USD value directly; it must not silently invent a conversion rate.

**Owners — one row per owner record linked to an account/reporting group**

| Group | Logical columns |
|---|---|
| Link and role | `owner_id`, `account_id`, `owner_role`, `owner_order` |
| Owner identity | `owner_is_entity`, `last_name_or_organization_name`, `organization_name`, `first_name`, `middle_name`, `suffix`, `tax_id`, `tax_id_type` |
| Address | `street_address`, `city`, `state_province`, `postal_code`, `country_code` |
| Filer relationship | `filer_title_with_owner` |

Roles and mappings:

- `principal_joint_owner`: one principal-owner record under `FinAcctOwnedJointly/PrincipalJointOwner`; use `last_name_or_organization_name`. Do not emit one record for every joint owner: the separate count is the number of other joint owners.
- `no_financial_interest_owner`: one or more records under `NoFinInterestFinAcctOwned/NoInterestAcctOwner`; includes `filer_title_with_owner`.
- `consolidated_owner`: one or more records under `ConsolidatedAcct/ConsolidateAcctOwner`; use `organization_name`. Individual-name fields and `owner_is_entity` are not serialized for this role.

Allow an owner-only reporting group with blank account-detail cells for the applicable 25-or-more reporting mode. Such a group is not a real account and must not increase account totals. Keep any detailed account inventory as local working data; let the versioned serializer apply the selected reporting mode. Owners may be edited in an expanded grid below their account; the underlying one-to-many relationship remains intact.

**Preparer — optional one row per report**

`filing_id`, `last_name`, `first_name`, `middle_name`, `self_employed`, `tax_id`, `tax_id_type`, `phone_number`, `phone_extension`, `firm_name`, `firm_tax_id`, `firm_tax_id_type`, `street_address`, `city`, `state_province`, `postal_code`, `country_code`.

The signature date, signing flag, signing timestamp and form/submission versions are system or runtime data, not freely editable spreadsheet columns. The `NoRegContactInformation` fields appear in the PDF's data description, but are not active bound user-entry controls in this template. Portal contact details are separate from this PDF mapping.

See [the complete field dictionary](fbar-field-dictionary.md) for all exact paths and declared limits, and [the machine-readable catalog](fbar-field-catalog.json) for bindings and enumerations. Duplicate logical columns in that dictionary represent their mappings in different sections.

## 5. XML mapping and important encoding differences

Read the `datasets` packet from the PDF object graph, decompressing the stream through a PDF parser. Its relevant root is:

```text
xfa:datasets
  xfa:data
    fbar:BSAForm
      FilerInformation
      FinAcctOwnedSeparately (repeated)
      FinAcctOwnedJointly (repeated)
        PrincipalJointOwner
      NoFinInterestFinAcctOwned (repeated)
        NoInterestAcctOwner (repeated)
      ConsolidatedAcct (repeated)
        ConsolidateAcctOwner (repeated)
```

Namespace URIs:

```text
xfa = http://www.xfa.org/schema/xfa-data/1.0/
fbar = http://www.fincen.gov/bsa/ffbar/2011-06-01
efile = http://www.fincen.gov/bsa/efile-submission-types/2009-01-01
common = http://www.fincen.gov/bsa/ucommon-components/2011-06-01
contact = http://www.fincen.gov/bsa/no-reg-contact-information/2009-01-01
dd = http://ns.adobe.com/data-description/
```

Use namespace-aware traversal. Prefix spellings can change. The JSON catalog now provides `qualified_xml_path` for all 129 fields. EFile submission children and address/signature children use their own namespaces; do not place every node in the main FBAR namespace. The data description is schema metadata, not another set of actual account records. Ignore non-business `FS...` transport nodes and unknown unbound fields for table entry; retain their presence as import diagnostics.

| Semantic value | Encoding in this PDF |
|---|---|
| Account type | `A` bank, `B` securities, `Z` other |
| Filer type | `A` individual, `B` partnership, `C` corporation, `D` consolidated, `E` fiduciary/other |
| Filer US tax ID type | `A` EIN, `B` SSN/ITIN |
| Joint/Part IV owner tax ID type | `A` EIN, `B` SSN/ITIN, `C` foreign, `D` unknown |
| Consolidated owner tax ID type | `A` EIN, `B` SSN/ITIN, `C` foreign |
| Preparer tax ID type | `B` SSN/ITIN, `C` foreign, `D` PTIN |
| Preparer firm tax ID type | `A` EIN, `C` foreign |
| Foreign ID type | `A` passport, `B` foreign TIN, `Z` other |
| Checked ordinary checkbox | `X`; unchecked is empty |
| 25-or-more yes/no | `A` yes, `B` no; empty is unanswered |
| Late-filing reason | Codes `A` through `I`, or `Z` other; catalog contains labels |
| Birth date | `MMDDYYYY` in the hidden bound field; displayed as `MM/DD/YYYY` |
| Signature date | Bind picture is `date{MMDDYYYY}`; generated during signing |
| Country/state | Codes supplied by `StatesAndCountriesJS`, with field-specific restrictions |

The DOB mapping is verified in `Common.setDateBindField`: it concatenates month, day, then year. For example, canonical `1980-01-02` becomes `01021980`. **Do not use the separate FinCEN batch XML schema's date convention or element names for this XFA data packet.** Batch XML is a different submission format.

**Runtime finding:** `BSAForm.Part1.DobLastSub.dob` has `bind match="none"`; the separate `dateOfBirthBindField` binds `FilerInformation/DOB`. Data-only import can leave the visible date empty, and its validation script then clears the bound DOB. The tested adapter enters `MM/DD/YYYY` through the visible widget's native input and exit events. It also runs `CountryIndividual`'s exit event to refresh State/ZIP requiredness. Pure XML import or a minimal handwritten `form` packet did not resolve these behaviors in the tested engine.

Declared template limits include: filing name 40 characters; institution name 150; account number 40; account-type description 50; street address 100; city 50; postal code 9; maximum value 15 integer digits; joint-owner count 3 digits; late-filing narrative 750 characters. Block overflow before export; never silently truncate. Static metadata alone does not capture every conditional validation rule.

## 6. User workflow

1. Start a blank filing or choose a local PDF. Import inspection identifies form version, populated sections, signing state and unsupported content.
2. Choose **Edit this report** or **Use for a new year**. A new-year copy carries reusable identity/account/owner data, clears annual maximum values and unknown-value selections, clears amendments/prior-report references and late-filing answers, and marks every account for review. Let the user choose the new report year. Reconfirm the 25-or-more declarations and counts. Never reuse signing state or date.
3. Enter and edit data in the grids. Freeze institution/account columns; hide inapplicable columns; show conditional owner/preparer fields. Clipboard paste produces an import preview and row/column-specific errors.
4. Review errors and annual-review flags. Save a local draft at any time.
5. Generate a PDF only through the validated export route. Present draft, validated, signed and saved states accurately; never label a data-only draft “ready to file.”
6. Let the user reselect the actual final saved PDF for comparison. Display missing/extra accounts, field differences, owner-link differences and unsupported fields.
7. The user manually uploads through the government site. The app has no automatic filing or submission feature.

For signed prior filings, import data read-only and create a separate editable draft using a clean official template. Editing must require a fresh signing act. Do not use a previously completed PDF as a distributable template: personal values can remain in datasets, saved form state, metadata and earlier PDF revisions.

## 7. Local browser architecture and privacy contract

```text
Local PDF / clipboard
        |
        v
PDF worker -> XFA data parser -> versioned canonical model
                                      |
                             tables + local rules
                                      |
                              XFA export adapter
                                      |
                              downloaded PDF
                                      |
                         independent re-import + diff
```

Use a static TypeScript application. Put PDF parsing and serialization in Web Workers so large files do not freeze the grid. Keep the canonical model independent of any grid/PDF library. Maintain separate import/export adapters per recognized form version; identify templates using structural fingerprints as well as version fields.

Local handling requirements:

- Read files with browser File APIs into memory; download with Blob/object URLs. No document upload endpoint.
- Bundle scripts, styles, fonts, PDF workers, optional OCR and all other assets. No runtime CDN, analytics, remote logging, session replay, AI extraction or cloud conversion.
- Use an isolated editor origin/context, `form-action 'none'`, restricted script/worker/image sources and no remote embeds. Foxit's XFA runtime uses service-worker-intercepted synchronous requests, so do not assume `connect-src 'none'` is compatible. Allow only the specifically tested local SDK messaging path and required bundled assets; block remote origins. Require a controlling service worker before opening personal data and fail closed on loss of control. A downloadable build served from a loopback-only static launcher keeps even an accidental messaging fallback on the user's computer. The launcher serves assets only and has no document-processing API. A remotely hosted build needs a separately verified fail-closed network policy. Pass PDFs as bytes, not remote URLs.
- Import XML as data. Disable external entity/DTD resolution in the chosen parser; enforce limits on document size, decompressed streams, nesting and repeated nodes. Do not evaluate arbitrary embedded PDF scripts during import. Escape values as text in the UI and XML writer.
- Default to memory only. An explicit Save Draft downloads a versioned JSON file; optionally provide password-encrypted local drafts. Browser persistence is opt-in, with a clear erase control. Cache application assets separately from user files.
- Test import, paste, editing, export and comparison with all network access disabled. Instrument requests and assert that no personal data or document bytes leave the browser. Test SDK licensing/telemetry behavior too if considering a commercial engine.

An offline downloadable build is desirable. Initial delivery of static app assets may involve a network connection, but no personal-data operation should require one. Explain that “download PDF” saves to the user's filesystem and that uploading to FinCEN is a later user action.

## 8. Selected PDF export implementation

Use Foxit PDF SDK for Web with the dynamic XFA module. Its WebAssembly runtime includes XFA layout and scripting. [Foxit setup and modules](https://developers.foxit.com/documents/development-guide/pdf-sdk-web/getting-started.html). Its documented XFA import/export APIs are useful, but the tested FBAR path also needs explicit widget synchronization. [PDFDoc API](https://webviewer-demo.foxit.com/docs/API_Reference/html/class_p_d_f_doc.html).

The local prototype appends a replacement `datasets` stream and a new cross-reference stream without rewriting the original template. The SDK then creates runtime instances, synchronizes the visible date/country fields, executes the original Sign button, presents its acknowledgment and saves. The final independent read-back verifies the data, signature flag and stored instance count. The 1-, 3- and 20-account data-writing tests passed; the complete sign/save workflow was exercised for 20 separately owned accounts. Full mixed-section qualification remains required.

The standard `pdf-lib` form API explicitly does not support reading, modifying or creating XFA fields. It cannot fill this file via `getTextField()`. [pdf-lib XFA limitation](https://pdf-lib.js.org/docs/api/classes/pdfform#hasxfa). Nutrient Web SDK also documents XFA forms as unsupported. [Nutrient forms documentation](https://www.nutrient.io/guides/web/forms/).

PDF.js 6.3.289 was subsequently tested with our custom writer. It renders 24 synthetic accounts as 14 pages, and custom-writer export preserves all 209 populated values. Its native save loses business XML namespaces and fails to synchronize the unbound DOB; embedded signing, validation and add-instance actions do not execute. Use it for preview with table-authoritative custom export, not full FBAR finalization. See the [measured PDF.js results and runnable experiment](fbar-pdfjs-feasibility.md).

Production export sequence, based on the tested synthetic route:

1. Serialize canonical data into the exact XFA `datasets` structure, preserving namespace and repeated-node order. Handle the empty scaffolding the template expects.
2. Use a tested PDF writer to update the relevant stream through the object graph. Prefer evaluating incremental updates because the form has a usage-rights signature; preserving original bytes is necessary for many signature-preserving workflows but is not itself proof that an update is permitted or that Reader rights remain valid.
3. Resolve the saved `form` packet deliberately. It stores instance counts, access/presence and unbound state. Changing only `datasets` while retaining stale `form` state may produce the wrong displayed fields, pages or locks. Establish a supported regeneration/synchronization procedure; do not assume deleting the packet is harmless.
4. Preserve official template/scripts, document structure and Reader permissions. Check their actual behavior after reopening. Avoid a generic full-document rewrite until its effects are understood.
5. Run the runtime's official validation. Obtain the user's explicit signing action, set the date through the normal workflow and save. For a strict browser engine, this whole behavior needs verified equivalent support.
6. Reopen the saved bytes independently, compare the data, and inspect the rendered pages in the authoritative runtime. Verify a final save and subsequent reopen do not lose rows or revert data.

The supplied sign handler calls `FFBARFormActions.processSignButtonClick`. It validates, opens an Adobe `app.execDialog` acknowledgment through `SIGNJS`, stamps date/time, locks fields and sets an unbound signing flag. The saved `form` packet, not merely `datasets/FilerInformation/FilerSignature`, matters. A program that just sets `Signed = 1` has not reproduced the user workflow. The `/UR3` usage-rights signature is separate from this filing acknowledgment.

FinCEN's published PDF procedure includes validation, signing and saving before upload. [FinCEN PDF procedure](https://bsaefiling.fincen.gov/resources/FBAR_EFILING.pdf). Confirm current portal compatibility through the applicable official test/support process before public release; never submit synthetic reports to production. No acceptance test was performed for this specification.

## 9. Validation and import coverage

Implement three distinct layers:

- **Input rules:** types, required/conditional fields, enum codes, lengths, account/owner relationships and explicit annual review.
- **Semantic round trip:** compare canonical values with a fresh import of the final saved PDF, accounting only for documented normalizations.
- **Runtime and filing compatibility:** verify actual dynamic layout, signing, persistence and the accepted filing format. A passing round trip cannot establish these properties.

Normalize whitespace and enum/date representations explicitly. Preserve identifiers exactly unless the official field rules require a disclosed transformation. Compare accounts by category plus stable export order and an export manifest, with institution/account identifiers as cross-checks. Do not merge accounts automatically on matching account numbers. Compare owner nesting/cardinality and values, not only flattened row counts. Detect missing, extra and duplicated records. Keep an explicit allowlist for generated fields such as signature date and versions; do not ignore unexplained differences.

Some requiredness depends on whether an entire section is unused. Exclude truly empty scaffolding while retaining a partially populated record and flagging its missing data. Preserve zero values. Reject incompatible combinations such as a populated known balance with the unknown-value checkbox, or a populated “other” description paired with the wrong account type. Country/state lists are field-specific and initialized by scripts, so the static dropdown list alone is insufficient.

Report whole-dollar USD amounts rounded upward; the count of joint owners excludes the filer. The 25-or-more declarations change which account details are reported: separate/joint details can be omitted, while relevant Part IV/V owner information remains required. Implement these branches explicitly and keep working inventory distinct from serialized reporting groups. [FinCEN electronic filing instructions, Attachment C](https://bsaefiling.fincen.gov/docs/XMLUserGuide_FinCENFBAR.pdf).

| Input PDF type | Import behavior |
|---|---|
| Recognized dynamic XFA | Parse structured data deterministically; show unrecognized nodes and version differences. |
| Signed recognized XFA | Extract data without executing scripts or modifying the original; create a new unsigned working draft. |
| Other XFA version | Detect and require a tested adapter; do not guess output mappings. |
| AcroForm PDF | Optional separate field adapter; its presence does not establish that it is a valid government filing template. |
| Flat text PDF / online filing copy | Optional local text-extraction assistance, with field-level review; no claim of lossless extraction or resubmittability. |
| Scan | Optional bundled local OCR, always requiring review; no server fallback. |
| Encrypted, damaged, unsupported PDF | Explain the specific limitation without discarding existing table data. |

## 10. Acceptance criteria and implementation order

Start with the export feasibility spike, import adapter and field model. Then build the grid, rollover behavior and local drafts. Finish with independent comparison and end-to-end export qualification. Do not spend most of the implementation effort on the grid before resolving the PDF engine.

Required fixtures and checks:

1. Supplied PDF imported locally: correct distinct populated account counts and owner links; empty placeholders excluded; no personal values in logs.
2. Synthetic 1-, 2- and 20-account filings in each section; mixed sections; multiple nested Part IV/V owners; account/owner additions and removals verified after save/reopen.
3. Zero accounts where a reporting mode permits it, unknown maximum, zero maximum, leading-zero identifiers, long-field rejection and empty optional fields. Synthetic text must contain only ASCII letters, digits and spaces, per the project's AGENTS.md; do not generate special-character test data.
4. Distinct yes/no/unanswered states; exact enum mappings; DOB and signature-date encodings; unknown ID types and entity-owner conditions.
5. Both 25-or-more branches, consolidated owner-only reporting, amendments, late-filing explanations and third-party preparer fields.
6. New-year copy cannot retain last year's balances as current validated values or reuse signing metadata. Signed input remains unchanged.
7. A seeded incorrect value, missing account, duplicate account and owner assigned to the wrong account are each detected by final-PDF comparison.
8. Reader rights, generated page content, official validation, explicit signing, final save and subsequent reopen all pass with synthetic fixtures. A third-party writer must not leave stale locks or old instances.
9. Chrome, Firefox and Safari offline import/edit/export/compare checks, keyboard accessibility, cancellation of large imports and no network transmission.
10. Filing-format compatibility is documented separately from data correctness. If strict browser execution cannot pass, present the measured limitation and Adobe fallback before changing the product promise.

The result includes the specification, 129-field namespace-aware catalog and a working synthetic browser export prototype. Confirmed: XFA repetition, local PDF writing, browser page generation, official signing acknowledgment, offline save and exact populated-value read-back for the 20-account fixture. Remaining release checks: supported SDK integration/licensing, complete form-branch/browser coverage, font/layout fidelity, Reader rights and FinCEN filing-format acceptance. See the resolution report for the precise test scope.
