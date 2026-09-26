# Project instructions

## Synthetic test data

The user requires plain synthetic data. For invented text values, use only ASCII letters, digits, and spaces. Do not use quotation marks, apostrophes, ampersands, angle brackets, accented characters, or other special characters in synthetic names, addresses, account identifiers, descriptions, or other invented text. This also applies to negative-test data; use missing values, invalid plain-letter codes, or excessive lengths instead.

Keep the government's original template, code lists, and required metadata unchanged. Required field formatting (for example a date displayed as MM/DD/YYYY), filenames, code syntax, XML/JSON syntax, and transport test URLs are structural formatting, not invented text values.

Enforce this rule in fixture generators. Regenerate affected QA artifacts when changing fixtures. Do not copy real personal data into synthetic tests or send personal FBAR PDFs to external services.
