# FBAR Magician design studies

Three standalone interactive prototypes for comparing different information architectures. They do not change the existing editor or connect to its PDF engine.

Run from the repository root:

```sh
node prototype/designs/server.cjs
```

Open [the comparison workspace](http://127.0.0.1:3142/). Use the top navigation to switch designs. No dependencies or external resources are required. The HTML file can also be opened directly.

- **Ledger** (`#ledger`): an editorial workspace with section navigation, searchable account register, attention filter, detail dialogs and a review summary. Best for seeing the whole report and returning to familiar tasks.
- **Guided** (`#guided`): a four step sequence with a focused balance entry screen. Best for occasional filers who want a clear next action.
- **Review desk** (`#review`): a compact account register, persistent editor and a live report outline. Best for repeated editing and checking many accounts.

Try adding an account, entering the missing Alpine Financial balance, searching the account register, and opening the handoff preview. Each design has independent in-memory state. Reload to reset all sample data. On narrow screens, Ledger uses account cards and Review desk stacks its panels.

All sample business values use only ASCII letters, digits and spaces. The fixture factory enforces this rule. No personal PDFs, external assets, browser storage or network services are used. Import, complete form validation, PDF export, signing and submission are intentionally outside these design studies. The report outline is an illustrative UI element, not the government form.

Start with Ledger as the general-purpose direction. Guided reduces choices for a first-time user; Review desk prioritizes density and cross-checking. These alternatives are meant to be compared before implementing a selected design in the production workflow.
