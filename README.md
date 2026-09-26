# FBAR Magician

[FBAR Magician](output/fbar-local-workflow.md) supports completed-PDF import, filer/account/owner/preparer tables, explicit save/resume of unfinished work with a privacy notice, undo, year rollover, linked validation feedback, responsive account details, checked unsigned export and saved-PDF comparison. All processing stays in the browser. Final review and signing take place in Adobe Reader.

The earlier [PDF.js + custom writer experiment](output/fbar-pdfjs-feasibility.md) documents rendering and native PDF.js export limitations.

The earlier [commercial browser export experiment](output/fbar-export-feasibility.md) documents the Foxit signing prototype and remaining production checks.

- [Application specification](output/fbar-app-specification.md)
- [Logical spreadsheet columns and field dictionary](output/fbar-field-dictionary.md)
- [Machine-readable field catalog](output/fbar-field-catalog.json)
- [Prototype and test instructions](prototype/README.md)
- [Adobe handoff test and next steps](output/fbar-reader-handoff.md)
- [Current local workflow and qualification](output/fbar-local-workflow.md)
- [Quality review and remaining work](output/fbar-quality-review.md)
- [Persistent synthetic data rules](AGENTS.md)

The user's completed PDF was analyzed locally. The prototype fixtures contain only public template data and invented test records. No filing was submitted. This remains a prototype for the exact tested template; see the current workflow report for scope and limitations.

Generated QA artifacts in `prototype/results/` stay local and are excluded from the public repository. Run the test scripts in [the prototype instructions](prototype/README.md) to recreate them with synthetic data.
