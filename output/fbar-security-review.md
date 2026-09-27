# Security review

Reviewed on 2026-09-26. Scope: the local static server, browser PDF import and comparison, saved-work import, trusted-template export, DOM output, and locked JavaScript dependencies. Tests use only the public blank and synthetic data.

## Findings addressed

1. **Local file disclosure through asset routing.** The server checked a directory prefix before resolving the decoded filename. A request for `/fixtures/%2e%2e%2fpackage.json` returned HTTP 200; the same technique could reach local results within the prototype directory. Whole-directory serving also exposed unintended files, and the lexical path check did not constrain symlink destinations. The server now checks decoded path components, permits specific application assets and selected runtime resources, and rejects symlink redirection. Existing loopback binding, Host validation, no-store caching, and content security policy remain in place.

2. **Resource exhaustion from compressed PDF imports.** The 25 MB input check did not constrain decompression, and parsing ran on the editor thread. A compact PDF could inflate large XFA or PDF object streams before the XML size check. Import and comparison now use a worker with a deadline and guards on decoder buffer allocation, including intermediate filter streams and streams decoded during PDF loading. Strict parsing prevents malformed-object recovery from swallowing a budget error. Unneeded XFA packets are not decoded, and packet count is limited. The worker returns only packet bytes; imported templates and scripts are never rendered or executed. A rejection preserves the current draft.

3. **Resource amplification from XML and saved-work records.** Small repeated XML elements could expand into thousands of complete schema records and editor controls. Deep XML also reached recursive comparison code without a depth limit. The parser now bounds markup count before DOM parsing and checks nesting depth. Data import checks the aggregate account and repeated-owner count before cloning records, for both PDF and saved-work imports.

## Verification

- `node prototype/scripts/security-test.cjs`: passed traversal, private-file, symlink, Host/header, XML complexity, record count, incomplete saved-work resume, XFA/object-stream expansion, aggregate decompression budget, editor responsiveness, draft preservation, offline recovery, worker timeout and restart checks.
- `node prototype/scripts/compatible-import-test.cjs`: passed compatible imports, trusted-template export, metadata exclusion, invalid-input rejection, repeat-file retry, and no external requests.
- `node prototype/scripts/audit-ui-test.cjs`: passed existing server, read-only preview, input validation and checked-download checks.
- `node prototype/scripts/pdfjs-test.cjs`: passed the existing preview/export characterization for 1, 3, 20 and 24 accounts. Its known native PDF.js save and scripting failures remain expected; the checked custom writer is the supported export path.
- `npm audit --json`: zero known vulnerabilities in the locked dependency tree at review time. Only dependency metadata was sent to the npm advisory service.

The installed PDF.js version is 6.3.289. Mozilla's [2026 scripting advisory](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j) lists a fix in 6.2.108. No dependency update was required by the audit.

## Maintenance and limits

The worker guard depends on pdf-lib 1.17.1 decoder internals and needs its regression tests when the library changes. The budgets constrain decompression buffers rather than all browser memory; the timeout isolates parser stalls from the editor. Input and XML complexity checks provide additional bounds. See the prototype README for exact limits and offline restart behavior. This review does not certify that every possible parser vulnerability is absent or that generated filings are accepted. Native Adobe signing was outside the changed paths and was not rerun.
