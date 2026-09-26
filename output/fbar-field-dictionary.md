# FBAR field dictionary

Extracted from the supplied form version 1.0.2. Contains schema metadata only, no submitted personal values.

Paths begin at `xfa:datasets/xfa:data/fbar:BSAForm`. The `fbar` namespace is `http://www.fincen.gov/bsa/ffbar/2011-06-01`. Paths below omit prefixes. `[*]` means repeated siblings. Blank, unknown, zero and unchecked are distinct. Requiredness is conditional.

The JSON companion also preserves exact template field paths, declared value constraints and namespace-qualified XML paths for all 129 fields. Address/signature and submission elements have additional namespaces; use those qualified paths for writing XML. The visible DOB is unbound and must be synchronized through the XFA runtime as described in the export report. See the app specification for app-only keys, rollover rules and validation.

## Filing

| Logical column | XFA XML path | Limits / encoding |
|---|---|---|
| `filing_name` | `EFileSubmissionInformation/FilingName` | text: maxChars=40 |
| `late_filing_reason` | `FilerInformation/LateFilingReason` | Forgot to file=A; Did not know that I had to file=B; Thought account balance was below reporting threshold=C; Did not know my account qualifies as foreign=D; Account statement not received in time=E; Account statement lost (replacement requested)=F; Late receiving missing required account information=G; Unable to obtain joint spouse signature in time=H; Unable to access BSA E-filing system=I; Other (Please provide explanation below)=Z |
| `late_filing_explanation` | `LatefilingNarrative/ExplanationOrDescription` | text: maxChars=750 |
| `report_year` | `FilerInformation/CalendarYear` | text: maxChars=4 |
| `is_amendment` | `FilerInformation/AmendToPriorReports` | Checked=X; Unchecked=blank |
| `prior_report_bsa_id` | `FilerInformation/DocumentControlNumber` | text: maxChars=14 |
| `filer_type` | `FilerInformation/TypeOfFiler` | Individual=A; Partnership=B; Corporation=C; Consolidated=D; Fiduciary or Other=E |
| `filer_type_other_description` | `FilerInformation/FilerOther` | text: maxChars=50 |
| `tax_id` | `FilerInformation/TIN` | text: maxChars=9 |
| `tax_id_type` | `FilerInformation/TINTYPE` | EIN=A; SSN/ITIN=B |
| `foreign_id_type` | `FilerInformation/ForeignId/ForeignIdType` | Passport=A; Foreign TIN=B; Other=Z |
| `foreign_id_other_description` | `FilerInformation/ForeignId/OtherIDDesc` | text: maxChars=50 |
| `foreign_id_number` | `FilerInformation/ForeignId/IdNumber` | text: maxChars=25 |
| `foreign_id_issuing_country` | `FilerInformation/ForeignId/IssueCountry` | Template script StatesAndCountriesJS; field initialization selects a context-specific subset. |
| `date_of_birth` | `FilerInformation/DOB` | MMDDYYYY in this XFA template; do not use the separate batch XML YYYYMMDD convention. |
| `last_name_or_organization_name` | `FilerInformation/LastNameOrNameOfOrg` | text: maxChars=150 |
| `first_name` | `FilerInformation/FirstName` | text: maxChars=35 |
| `middle_name` | `FilerInformation/MiddleName` | text: maxChars=35 |
| `suffix` | `FilerInformation/Suffix` | text: maxChars=35 |
| `street_address` | `FilerInformation/Address/Address` | text: maxChars=100 |
| `city` | `FilerInformation/Address/City` | text: maxChars=50 |
| `state_province` | `FilerInformation/Address/State` |  |
| `postal_code` | `FilerInformation/Address/ZIP` | text: maxChars=9 |
| `country_code` | `FilerInformation/Address/Country` | Template script StatesAndCountriesJS; field initialization selects a context-specific subset. |
| `financial_interest_25_or_more` | `FilerInformation/FIInterestIn25OrMore` | Yes=A; No=B |
| `financial_interest_account_count` | `FilerInformation/totalNumFIAccnts` | text: maxChars=4 |
| `signature_authority_25_or_more` | `FilerInformation/SigAuth25OrMore` | Yes=A; No=B |
| `signature_authority_account_count` | `FilerInformation/totalNumSigAuthAccnts` | text: maxChars=4 |
| `third_party_preparer` | `FilerInformation/PaidPreparer` | Checked=X; Unchecked=blank |
| `filer_title` | `SubmissionInformation/SignatureTitle` | text: maxChars=20 |

## Accounts

| Logical column | XFA XML path | Limits / encoding |
|---|---|---|
| `maximum_value_usd` | `FinAcctOwnedSeparately[*]/MaximumAccntValue` | decimal: fracDigits=0, leadDigits=15; Whole USD integer as decimal text, at most 15 digits in template; unknown uses a separate checkbox. |
| `maximum_value_unknown` | `FinAcctOwnedSeparately[*]/MaximumAccntUnkn` | Checked=X; Unchecked=blank |
| `account_type` | `FinAcctOwnedSeparately[*]/AccountType` | Bank=A; Securities=B; Other=Z |
| `account_type_other_description` | `FinAcctOwnedSeparately[*]/OtherDesc` | text: maxChars=50 |
| `institution_name` | `FinAcctOwnedSeparately[*]/FinInstName` | text: maxChars=150 |
| `account_number` | `FinAcctOwnedSeparately[*]/AccntNumber` | text: maxChars=40 |
| `institution_street_address` | `FinAcctOwnedSeparately[*]/Address/Address` | text: maxChars=100 |
| `institution_city` | `FinAcctOwnedSeparately[*]/Address/City` | text: maxChars=50 |
| `institution_country_code` | `FinAcctOwnedSeparately[*]/Address/Country` | Template script StatesAndCountriesJS; field initialization selects a context-specific subset. |
| `institution_state_province` | `FinAcctOwnedSeparately[*]/Address/State` |  |
| `institution_postal_code` | `FinAcctOwnedSeparately[*]/Address/ZIP` | text: maxChars=9 |
| `maximum_value_usd` | `FinAcctOwnedJointly[*]/MaximumAccntValue` | decimal: fracDigits=0, leadDigits=15; Whole USD integer as decimal text, at most 15 digits in template; unknown uses a separate checkbox. |
| `maximum_value_unknown` | `FinAcctOwnedJointly[*]/MaximumAccntUnkn` | Checked=X; Unchecked=blank |
| `account_type` | `FinAcctOwnedJointly[*]/AccountType` | Bank=A; Securities=B; Other=Z |
| `account_type_other_description` | `FinAcctOwnedJointly[*]/OtherDesc` | text: maxChars=50 |
| `institution_name` | `FinAcctOwnedJointly[*]/FinInstName` | text: maxChars=150 |
| `account_number` | `FinAcctOwnedJointly[*]/AccntNumber` | text: maxChars=40 |
| `institution_street_address` | `FinAcctOwnedJointly[*]/Address/Address` | text: maxChars=100 |
| `institution_city` | `FinAcctOwnedJointly[*]/Address/City` | text: maxChars=50 |
| `institution_state_province` | `FinAcctOwnedJointly[*]/Address/State` |  |
| `institution_postal_code` | `FinAcctOwnedJointly[*]/Address/ZIP` | text: maxChars=9 |
| `institution_country_code` | `FinAcctOwnedJointly[*]/Address/Country` | Template script StatesAndCountriesJS; field initialization selects a context-specific subset. |
| `joint_owner_count_excluding_filer` | `FinAcctOwnedJointly[*]/NOofJointOwners` | text: maxChars=3 |
| `maximum_value_usd` | `NoFinInterestFinAcctOwned[*]/MaximumAccntValue` | decimal: fracDigits=0, leadDigits=15; Whole USD integer as decimal text, at most 15 digits in template; unknown uses a separate checkbox. |
| `maximum_value_unknown` | `NoFinInterestFinAcctOwned[*]/MaximumAccntUnkn` | Checked=X; Unchecked=blank |
| `account_type` | `NoFinInterestFinAcctOwned[*]/AccountType` | Bank=A; Securities=B; Other=Z |
| `account_type_other_description` | `NoFinInterestFinAcctOwned[*]/OtherDesc` | text: maxChars=50 |
| `institution_name` | `NoFinInterestFinAcctOwned[*]/FinInstName` | text: maxChars=150 |
| `account_number` | `NoFinInterestFinAcctOwned[*]/AccntNumber` | text: maxChars=40 |
| `institution_street_address` | `NoFinInterestFinAcctOwned[*]/Address/Address` | text: maxChars=100 |
| `institution_city` | `NoFinInterestFinAcctOwned[*]/Address/City` | text: maxChars=50 |
| `institution_state_province` | `NoFinInterestFinAcctOwned[*]/Address/State` |  |
| `institution_postal_code` | `NoFinInterestFinAcctOwned[*]/Address/ZIP` | text: maxChars=9 |
| `institution_country_code` | `NoFinInterestFinAcctOwned[*]/Address/Country` | Template script StatesAndCountriesJS; field initialization selects a context-specific subset. |
| `maximum_value_usd` | `ConsolidatedAcct[*]/MaximumAccntValue` | decimal: fracDigits=0, leadDigits=15; Whole USD integer as decimal text, at most 15 digits in template; unknown uses a separate checkbox. |
| `maximum_value_unknown` | `ConsolidatedAcct[*]/MaximumAccntUnkn` | Checked=X; Unchecked=blank |
| `account_type` | `ConsolidatedAcct[*]/AccountType` | Bank=A; Securities=B; Other=Z |
| `account_type_other_description` | `ConsolidatedAcct[*]/OtherDesc` | text: maxChars=50 |
| `institution_name` | `ConsolidatedAcct[*]/FinInstName` | text: maxChars=150 |
| `account_number` | `ConsolidatedAcct[*]/AccntNumber` | text: maxChars=40 |
| `institution_street_address` | `ConsolidatedAcct[*]/Address/Address` | text: maxChars=100 |
| `institution_city` | `ConsolidatedAcct[*]/Address/City` | text: maxChars=50 |
| `institution_state_province` | `ConsolidatedAcct[*]/Address/State` |  |
| `institution_postal_code` | `ConsolidatedAcct[*]/Address/ZIP` | text: maxChars=9 |
| `institution_country_code` | `ConsolidatedAcct[*]/Address/Country` | Template script StatesAndCountriesJS; field initialization selects a context-specific subset. |

## Owners

| Logical column | XFA XML path | Limits / encoding |
|---|---|---|
| `tax_id` | `FinAcctOwnedJointly[*]/PrincipalJointOwner/TIN` | text: maxChars=25 |
| `tax_id_type` | `FinAcctOwnedJointly[*]/PrincipalJointOwner/TINTYPEU` | EIN=A; SSN/ITIN=B; Foreign=C; Unknown=D |
| `owner_is_entity` | `FinAcctOwnedJointly[*]/PrincipalJointOwner/OwnerEntityIndicator` | Checked=X; Unchecked=blank |
| `last_name_or_organization_name` | `FinAcctOwnedJointly[*]/PrincipalJointOwner/LastName` | text: maxChars=150 |
| `first_name` | `FinAcctOwnedJointly[*]/PrincipalJointOwner/FirstName` | text: maxChars=35 |
| `middle_name` | `FinAcctOwnedJointly[*]/PrincipalJointOwner/MiddleName` | text: maxChars=35 |
| `suffix` | `FinAcctOwnedJointly[*]/PrincipalJointOwner/Suffix` | text: maxChars=35 |
| `street_address` | `FinAcctOwnedJointly[*]/PrincipalJointOwner/Address/Address` | text: maxChars=100 |
| `city` | `FinAcctOwnedJointly[*]/PrincipalJointOwner/Address/City` | text: maxChars=50 |
| `state_province` | `FinAcctOwnedJointly[*]/PrincipalJointOwner/Address/State` |  |
| `postal_code` | `FinAcctOwnedJointly[*]/PrincipalJointOwner/Address/ZIP` | text: maxChars=9 |
| `country_code` | `FinAcctOwnedJointly[*]/PrincipalJointOwner/Address/Country` | Template script StatesAndCountriesJS; field initialization selects a context-specific subset. |
| `last_name_or_organization_name` | `NoFinInterestFinAcctOwned[*]/NoInterestAcctOwner[*]/LastName` | text: maxChars=150 |
| `owner_is_entity` | `NoFinInterestFinAcctOwned[*]/NoInterestAcctOwner[*]/OwnerEntityIndicator` | Checked=X; Unchecked=blank |
| `tax_id` | `NoFinInterestFinAcctOwned[*]/NoInterestAcctOwner[*]/TIN` | text: maxChars=25 |
| `tax_id_type` | `NoFinInterestFinAcctOwned[*]/NoInterestAcctOwner[*]/TINTYPEU` | EIN=A; SSN/ITIN=B; Foreign=C; Unknown=D |
| `first_name` | `NoFinInterestFinAcctOwned[*]/NoInterestAcctOwner[*]/FirstName` | text: maxChars=35 |
| `middle_name` | `NoFinInterestFinAcctOwned[*]/NoInterestAcctOwner[*]/MiddleName` | text: maxChars=35 |
| `suffix` | `NoFinInterestFinAcctOwned[*]/NoInterestAcctOwner[*]/Suffix` | text: maxChars=35 |
| `street_address` | `NoFinInterestFinAcctOwned[*]/NoInterestAcctOwner[*]/Address/Address` | text: maxChars=100 |
| `city` | `NoFinInterestFinAcctOwned[*]/NoInterestAcctOwner[*]/Address/City` | text: maxChars=50 |
| `state_province` | `NoFinInterestFinAcctOwned[*]/NoInterestAcctOwner[*]/Address/State` |  |
| `postal_code` | `NoFinInterestFinAcctOwned[*]/NoInterestAcctOwner[*]/Address/ZIP` | text: maxChars=9 |
| `country_code` | `NoFinInterestFinAcctOwned[*]/NoInterestAcctOwner[*]/Address/Country` | Template script StatesAndCountriesJS; field initialization selects a context-specific subset. |
| `filer_title_with_owner` | `NoFinInterestFinAcctOwned[*]/NoInterestAcctOwner[*]/FilerTitle` | text: maxChars=20 |
| `organization_name` | `ConsolidatedAcct[*]/ConsolidateAcctOwner[*]/CorporateName` | text: maxChars=150 |
| `tax_id` | `ConsolidatedAcct[*]/ConsolidateAcctOwner[*]/TIN` | text: maxChars=25 |
| `tax_id_type` | `ConsolidatedAcct[*]/ConsolidateAcctOwner[*]/TINTYPE` | EIN=A; SSN/ITIN=B; Foreign=C |
| `street_address` | `ConsolidatedAcct[*]/ConsolidateAcctOwner[*]/Address/Address` | text: maxChars=100 |
| `city` | `ConsolidatedAcct[*]/ConsolidateAcctOwner[*]/Address/City` | text: maxChars=50 |
| `postal_code` | `ConsolidatedAcct[*]/ConsolidateAcctOwner[*]/Address/ZIP` | text: maxChars=9 |
| `state_province` | `ConsolidatedAcct[*]/ConsolidateAcctOwner[*]/Address/State` |  |
| `country_code` | `ConsolidatedAcct[*]/ConsolidateAcctOwner[*]/Address/Country` | Template script StatesAndCountriesJS; field initialization selects a context-specific subset. |

## Preparer

| Logical column | XFA XML path | Limits / encoding |
|---|---|---|
| `last_name` | `PaidPreparerInformation/LastName` | text: maxChars=150 |
| `first_name` | `PaidPreparerInformation/FirstName` | text: maxChars=35 |
| `middle_name` | `PaidPreparerInformation/MiddleName` | text: maxChars=35 |
| `self_employed` | `PaidPreparerInformation/SelfEmployed` | Checked=X; Unchecked=blank |
| `tax_id` | `PaidPreparerInformation/TIN` | text: maxChars=25 |
| `tax_id_type` | `PaidPreparerInformation/TINTYPE` | SSN/ITIN=B; Foreign=C; PTIN=D |
| `phone_number` | `PaidPreparerInformation/TelephoneNumber` | text: maxChars=16 |
| `phone_extension` | `PaidPreparerInformation/TelephoneExt` | text: maxChars=6 |
| `firm_name` | `PaidPreparerInformation/FirmName` | text: maxChars=150 |
| `firm_tax_id` | `PaidPreparerInformation/EIN` | text: maxChars=25 |
| `street_address` | `PaidPreparerInformation/Address/Address` | text: maxChars=100 |
| `firm_tax_id_type` | `PaidPreparerInformation/EINType` | EIN=A; Foreign=C |
| `city` | `PaidPreparerInformation/Address/City` | text: maxChars=50 |
| `state_province` | `PaidPreparerInformation/Address/State` |  |
| `postal_code` | `PaidPreparerInformation/Address/ZIP` | text: maxChars=9 |
| `country_code` | `PaidPreparerInformation/Address/Country` | Template script StatesAndCountriesJS; field initialization selects a context-specific subset. |

## System

| Logical column | XFA XML path | Limits / encoding |
|---|---|---|
| `specification_version` | `EFileSubmissionInformation/SpecificationVersion` |  |
| `submission_url` | `EFileSubmissionInformation/SubmitUrl` |  |
| `submission_type` | `EFileSubmissionInformation/FilingType` |  |
| `form_version` | `EFileSubmissionInformation/VersionNumber` |  |
| `signature_date` | `SubmissionInformation/SignatureDate` | MMDDYYYY in this XFA template; do not use the separate batch XML YYYYMMDD convention. |
