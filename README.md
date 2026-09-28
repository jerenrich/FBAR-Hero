# FBAR Magician

FBAR Magician helps you fill out an FBAR more efficiently. Instead of working through the PDF one field at a time, you can enter filer and account details in organized tables, check your entries, and download an unsigned PDF for final review.

If you filed in a previous year, you can import your completed FBAR and copy its accounts into a new draft. Choose the next reporting year, then review the accounts and add that year's balances. The app clears prior-year balances and other year-specific answers during this step so they are not carried forward by mistake.

## What you can do

- **Start fresh or pick up where you left off.** Create a blank draft or open an FBAR PDF to continue editing or reuse a previous filing.
- **Manage accounts in one place.** Add and edit accounts, addresses, owners, and filer details in tables that work on desktop and narrow screens.
- **Reuse accounts next year.** Carry account details forward while clearing annual values for review.
- **Catch issues before downloading.** Follow links from validation messages to the fields that need attention, then download a checked unsigned PDF.
- **Keep control of your files.** The app processes documents in your browser. Save a PDF whenever you want to keep your work; it does not upload your documents.

## Try the prototype locally

With Node.js 22.13 or later installed, run these commands from the repository root:

```sh
npm --prefix prototype install
node prototype/pdfjs/server.cjs
```

Open [http://127.0.0.1:3141](http://127.0.0.1:3141) in your browser. Choose **New blank draft** or **Open FBAR**.

FBAR Magician is a prototype for the tested FBAR PDF template. It creates an **unsigned draft**; review, validate, sign, and save the PDF in Adobe Reader before using the official filing workflow. The app does not submit a filing. Saved PDFs are unencrypted and contain the information you entered, so keep them in a private location.

## More information

- [Cloudflare Pages deployment and app structure](CLOUDFLARE.md)
- [How to use the local workflow](output/fbar-local-workflow.md)
- [Prototype setup and tests](prototype/README.md)
- [Current quality review and limits](output/fbar-quality-review.md)
- [Application specification](output/fbar-app-specification.md)
- [Field dictionary](output/fbar-field-dictionary.md)
- [Technical experiments](output/fbar-pdfjs-feasibility.md)
- [Synthetic test data rules](AGENTS.md)
