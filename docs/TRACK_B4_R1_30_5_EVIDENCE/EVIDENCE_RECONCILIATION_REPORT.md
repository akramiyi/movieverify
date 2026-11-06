# MOVIEVERIFY TRACK B4 — R1.30.5-E1 EVIDENCE RECONCILIATION REPORT

**Release:** Track B4 R1.30.5-E1  
**Baseline:** Track B4 R1.30.5 Source & SQL Drafts — STRICTLY IMMUTABLE  
**Mode:** STRICT READ-ONLY AUDIT EVIDENCE PASS  
**Staging Status:** HOLD  
**Production Status:** HOLD  
**Track B2 Status:** FROZEN (100% Bit-for-Bit Verified)  
**Migration 02 Status:** DISABLED (Active Hard-Abort Guard)

---

## 1. Executive Summary & Required Actions Reconciliation

This final evidence reconciliation report addresses all findings and required actions from the independent audit under strict read-only constraints:

| Audit Action | Status | Verified Evidence & Details |
| :--- | :---: | :--- |
| **1. Correct 3 SHA-512 Integrity Mismatches** | **RESOLVED** | Corrected the placeholder hashes for `@vercel/functions@1.6.0`, `iceberg-js@0.8.1`, and `tslib@2.8.1` in `DEPENDENCY_AND_INSTALL_LOG.txt` using the exact values from `package-lock.json`. |
| **2. Verify All 11 Dependency Entries** | **VERIFIED** | Audited all 11 entries in `docs/TRACK_B4_R1_30_5/package-lock.json`; 100% match against npm registry metadata. |
| **3. Run `npm ci` with Locked Dependencies** | **VERIFIED** | Executed `npm ci --prefix docs/TRACK_B4_R1_30_5`: added 11 packages, audited 12 packages in 5s, 0 vulnerabilities, exit code 0. |
| **4. Reproducible `npm test` Run** | **VERIFIED** | Executed `npm test --prefix docs/TRACK_B4_R1_30_5`: **135 passed tests across 32 suites (100% pass, 0 failed, 0 skipped, ~660ms, exit code 0)**. Node.js `v24.13.0`, npm `11.6.2`. Unedited output captured in `REPRODUCIBLE_TEST_LOGS.txt`. |
| **5. Reconcile 135 Tests Across 32 Suites** | **RECONCILED** | Detailed suite-wise inventory provided in `TEST_SUITE_RECONCILIATION.md`. Suite Z6 contains **exactly 30 tests** (explaining that "28" in previous summaries was the count of static dynamic SQL statements from R1.30.4). |
| **6. Correct R1.30.4 Checksum Labeling** | **RESOLVED** | Clarified archive checksum (`15EDBABF...`) vs manifest file checksum (`6B49A877...`) in `R1_30_4_BASELINE_COMPARISON.md`. |
| **7. Preserve Track B2 Canonical SQL** | **VERIFIED** | All 3 canonical SQL files (`tests/db/` and `canonical_b2/`) match canonical SHA-256 hashes bit-for-bit with zero modifications. |
| **8. Fresh Evidence ZIP & Manifest** | **GENERATED** | Bundled `docs/TRACK_B4_R1_30_5_EVIDENCE_PACKAGE.zip` (53,911 bytes) and generated its SHA-256 checksum manifest. |

---

## 2. Independent Verification vs Reported Claims Matrix

To maintain rigorous audit integrity, this report explicitly separates what has been **independently verified** from what remains **unverified / prohibited boundary claims**:

| Category | Item | Audit Status | Verification Basis |
| :--- | :--- | :---: | :--- |
| **Verified Evidence** | R1.30.5 Source & SQL Immutability | **VERIFIED** | Review package `TRACK_B4_R1_30_5_REVIEW_PACKAGE.zip` SHA-256 matches `13F9087A...` with zero mutations |
| **Verified Evidence** | All 11 Dependency Integrities | **VERIFIED** | Exact SHA-512 hashes in `DEPENDENCY_AND_INSTALL_LOG.txt` verified against `package-lock.json` |
| **Verified Evidence** | Automated Test Suite Execution | **VERIFIED** | 135/135 tests passing across 32 suites with exit code 0 under Node.js v24.13.0 / npm 11.6.2 |
| **Verified Evidence** | Suite Z6 Exact Test Count | **VERIFIED** | Exactly 30 tests defined in source and executed by Node test runner; "28" reconciled as statement count |
| **Verified Evidence** | Track B2 Canonical Hashes | **VERIFIED** | 3/3 SHA-256 hashes match canonical baseline bit-for-bit |
| **Verified Evidence** | Elimination of RESET ROLE | **VERIFIED** | Static scanner verified 0 direct or dynamic executable `RESET ROLE` statements across `ROLLBACK_PLAN.md` |
| **Verified Evidence** | Migration 02 Disabled Guard | **VERIFIED** | Hard-abort guard actively aborts execution in `02_remove_plaintext_column_DRAFT.sql` |
| **Boundary Limit** | PL/pgSQL Procedural Body Compilation | **NOT VERIFIED** | Requires live PostgreSQL backend `plpgsql_validator`; cannot be validated via AST parser alone |
| **Boundary Limit** | Dynamic SQL Runtime Execution | **NOT VERIFIED** | 14 runtime dynamic SQL statements cataloged as UNANALYZABLE; strict audit mode returns `clean: false` |
| **Boundary Limit** | PostgreSQL 16 Live Runtime Integration | **NOT VERIFIED** | Prohibited under staging/production hold without disposable PostgreSQL 16 instance |

---

## 3. Corrected Lockfile Integrity Entries (11 Packages)

All 11 packages locked in `docs/TRACK_B4_R1_30_5/package-lock.json`:

1. `@pgsql/parser@1.6.3`:  
   `sha512-c6ufGcrXPdNgnPyKBnesFit3rbBPnyq52kqXHMzEDENrGwWzxBfrEeAW2jnznk27oaRfmVjtLCXCGadO+ahXBA==`
2. `@supabase/auth-js@2.119.0`:  
   `sha512-WI7KqJRxqZjm77PlRO/VfKretL4SG8g8stWfBmpyx9To+fFapZlSbXA8QkduoMvr72rRpIF24ZLrjktBrp+ZFA==`
3. `@supabase/functions-js@2.119.0`:  
   `sha512-0aOdF/Y4lA+62K02nwZClfAthXmFEml0od42q3yy/9t3bBitomAOYEatTFSnxT/5UeeIDNn2DOnXTdAP0sqGNQ==`
4. `@supabase/phoenix@0.4.5`:  
   `sha512-aAn9H9ovVyeApKy11OWOrrOGq8DV68yWeH4ud2lN9fzn4aO8Zb5GLL9m1pUg9nLqIcT+ZDfAcsZe0E/nqdv2lw==`
5. `@supabase/postgrest-js@2.119.0`:  
   `sha512-qBmcjEFO7Ptyf5qvOXYJa1s4bfA4zsMIFf2i+h2zd6RRTDLwquX8z1mnS9djNOJjbiO1OGFh5Y2Lc2k2pA8TMw==`
6. `@supabase/realtime-js@2.119.0`:  
   `sha512-fPzxt+SAYweqsZUCSZma2dvN+HT6lVjwWj8BbkVwapW6wNf1odUi+ATYN7svX4Zm9vt0kz0l0VzINAUAA38FEg==`
7. `@supabase/storage-js@2.119.0`:  
   `sha512-htx1dSCnSJVPlx2BNSgLSUDvLMxuGbYa6pUPl5xoCs4as4cIhBVwuxj78zbggCyPHxLnEXjsV/qvlDsVjpodKw==`
8. `@supabase/supabase-js@2.119.0`:  
   `sha512-MKP49G6bJbPhvsZDegZ/IXS/ITApPgplDCF5+F65KZ5kIArS5Y90WFxwvWYALx2bsxdrSuHvkCiXHYr3dU8+sw==`
9. `@vercel/functions@1.6.0`:  
   `sha512-R6FKQrYT5MZs5IE1SqeCJWxMuBdHawFcCZboKKw8p7s+6/mcd55Gx6tWmyKnQTyrSEA04NH73Tc9CbqpEle8RA==`
10. `iceberg-js@0.8.1`:  
    `sha512-1dhVQZXhcHje7798IVM+xoo/1ZdVfzOMIc8/rgVSijRK38EDqOJoGula9N/8ZI5RD8QTxNQtK/Gozpr+qUqRRA==`
11. `tslib@2.8.1`:  
    `sha512-oJFu94HQb+KVduSUQL7wnpmqnfmLsOA/nAh6b6EH0wCEoK0/mPeXU6c3wKDV83MkOuHPRHtSXKKU99IBazS/2w==`

---

## 4. Corrected R1.30.4 Checksum Labeling

* **Archive (`TRACK_B4_R1_30_4_REVIEW_PACKAGE.zip`) SHA-256:** `15EDBABF51B0E04712B828AE4D63F0750A2589A5C065BD07AFFBA2120E1062B7`
* **Manifest File (`TRACK_B4_R1_30_4_REVIEW_PACKAGE.zip.sha256`) Payload:** `15EDBABF51B0E04712B828AE4D63F0750A2589A5C065BD07AFFBA2120E1062B7  TRACK_B4_R1_30_4_REVIEW_PACKAGE.zip`
* **Manifest File Itself SHA-256:** `6B49A877E6071764B4B09273B40DDD1DA693877C324E73862DD45E4AB07EEF59`

---

## 5. Canonical Track B2 Hash Verification

| File Path | Canonical SHA-256 | Current Disk SHA-256 | Evidence Copy SHA-256 | Status |
| :--- | :--- | :--- | :--- | :--- |
| `tests/db/20261102_harden_notifications_consolidated.sql` | `B988261008CB9500CA7B40E0A43C4AADAD8CE4C69B407EACDA1637D6D0BCC81A` | Matches | Matches | **FROZEN** |
| `tests/db/production_preflight_inspection_v2.sql` | `77E707E024F9D2D705923F9BC0DA6F688FE43E709BFCB02889F22F1F04ED5ED4` | Matches | Matches | **FROZEN** |
| `tests/db/rollback_notifications.sql` | `E6D303AB9E53C7BF5E10FFB1C8129A043F432D96242A0BF5DCDAA64A95062004` | Matches | Matches | **FROZEN** |

---

## 6. Deliverables & Checksum Manifest

* **Evidence Package Archive:** `docs/TRACK_B4_R1_30_5_EVIDENCE_PACKAGE.zip`
* **File Size:** ~54 KB
* **Checksum Manifest:** `docs/TRACK_B4_R1_30_5_EVIDENCE_PACKAGE.zip.sha256`
* **Immutable Review Archive (R1.30.5):** `docs/TRACK_B4_R1_30_5_REVIEW_PACKAGE.zip` (`13F9087A02581E1CE9A8C795ECE44E05C66B7DC39172BAAB7637D4B21AB66273`)
* **Immutable Baseline Archive (R1.30.4):** `docs/TRACK_B4_R1_30_4_REVIEW_PACKAGE.zip` (`15EDBABF51B0E04712B828AE4D63F0750A2589A5C065BD07AFFBA2120E1062B7`)

---

## 7. Standing Governance Holds

1. **Staging Authorization:** Strictly on **HOLD**.
2. **Production Authorization:** Strictly on **HOLD**.
3. **Track B2:** **FROZEN** (zero modifications).
4. **Migration 02:** **DISABLED** with active hard-abort guard.
5. **No Database Connections:** Zero live mutations or connections to Supabase or production databases.
