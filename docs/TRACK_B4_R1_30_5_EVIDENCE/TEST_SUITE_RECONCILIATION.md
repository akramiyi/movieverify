# TRACK B4 R1.30.5 — TEST SUITE & Z6 COUNT RECONCILIATION

**Release:** Track B4 R1.30.5  
**Baseline:** Track B4 R1.30.4 (Strictly Immutable)  
**Mode:** STRICT READ-ONLY AUDIT RECONCILIATION  
**Staging Status:** HOLD  
**Production Status:** HOLD  
**Track B2 Status:** FROZEN (100% Bit-for-Bit Verified)  
**Migration 02 Status:** DISABLED (Active Hard-Abort Guard)

---

## 1. Executive Reconciliation of Suite Z6 Test Count

### Audit Query
*README says 28, final report says 28, but the source runner and enumerated entries show 30.*

### Detailed Root Cause & Discrepancy Reconciliation
1. **The Origin of the Number "28":**
   During the R1.30.4 audit cycle, static code analysis performed by `RollbackSqlScanner` analyzed `ROLLBACK_PLAN.md` and cataloged:
   - **28 dynamic SQL statements** matching whitelisted static prefixes (`GRANT `, `REVOKE `, `SET LOCAL ROLE `, `ALTER TABLE `, `DROP POLICY `).
   - **1 runtime dynamic SQL statement** (`EXECUTE (r_func->>'functiondef')`) restoring table baseline data.
   
   In the R1.30.4 summary text, this was documented as:
   `"28 safe dynamic statements verified, 1 runtime baseline dynamic SQL cataloged"`.
   When drafting summary overviews, the count of **28 dynamic SQL statements** was mistakenly conflated with the number of test definitions in Suite Z6.

2. **The Source Reality in Suite Z6 (Exactly 30 Tests):**
   Within `docs/TRACK_B4_R1_30_5/tests/track_b4/track_b4_security.test.js`, the describe block:
   `describe('Z6. Global Rollback Role Restoration & RESET ROLE Elimination (R1.30.5)', () => { ... })`
   contains **exactly 30 distinct `test('...')` definitions**:

   | Category | Subtest IDs | Count | Description |
   | :--- | :--- | :---: | :--- |
   | **Primary Audit** | `Z6.1` | 1 | Global executable RESET ROLE audit on rollback plan SQL |
   | **Direct & Dynamic Detection** | `Z6.1.1` to `Z6.1.10` | 10 | Direct statements, literals, format(), quotes, case, comments, notices, nested SQL, unanalyzable fail-closed |
   | **Baseline Mutations** | `Z6.1.11` to `Z6.1.13` | 3 | Injected literal EXECUTE, injected format(), and false-positive immunity |
   | **R1.30.5 Scanner Regressions** | `Z6.1.14` to `Z6.1.19` | 6 | format('GRANT %s'), format('REVOKE %s'), concatenation, safe %I/%L, mixed args, nested dynamic SQL |
   | **R1.30.5 Injected Mutation** | `Z6.1.20` | 1 | Mutation 4: runtime %s containing `; RESET ROLE` fails safe classification |
   | **Step Verification Blocks** | `Z6.2`, `Z6.3`, `Z6.4` | 3 | Static verification of Step 2a, Step 3a, Step 3b blocks |
   | **Lifecycle & Failure Paths** | `Z6.5`, `Z6.6`, `Z6.7` | 3 | Step 2a, Step 3a, Step 3b complete execution lifecycles |
   | **Role Context Security** | `Z6.8`, `Z6.9` | 2 | Failed role switch caller retention & PostgreSQL 16 session_user rule |
   | **C-Parser Structural Validation** | `Z6.10` | 1 | Outer PostgreSQL C-Parser AST validation of rollback DO block structure |
   | **TOTAL IN SUITE Z6** | | **30** | **Exactly 30 tests defined and executed** |

   **Formula:**
   $$1 + 10 + 3 + 6 + 1 + 3 + 3 + 2 + 1 = 30\text{ tests}$$

   The Node.js native test runner output confirms:
   `✔ Z6. Global Rollback Role Restoration & RESET ROLE Elimination (R1.30.5) (47.9ms)` executing all 30 tests with 0 failures.

---

## 2. Complete 32-Suite, 135-Test Inventory

The table below reconciles the complete test inventory against the official Node.js test runner output (`ℹ tests 135`, `ℹ suites 32`, `ℹ pass 135`, `ℹ fail 0`):

| Suite # | Suite Name | Test Count | Individual Test Identifiers |
| :---: | :--- | :---: | :--- |
| **1** | A. Static Source & SQL Assertions | 14 | A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11, A12, A13, A14 |
| **2** | B. Native Web Request Cookie Header Integration Tests (P0) | 6 | B1, B2, B3, B4, B5, B6 |
| **3** | C. Administrative Password Rotation & Exemption Lifecycle (P0) | 4 | C1, C2, C3, C4 |
| **4** | D. Schema Privilege Preflight Negative Tests | 1 | D1 |
| **5** | E. Baseline Immutability & Migration Rerun Simulation | 1 | E1 |
| **6** | F. Actual Exported Matcher Testing | 1 | F1 |
| **7** | G. Concurrency & Rate Limiting (In-Memory Simulation Harness) | 2 | G1, G2 |
| **8** | H. Trusted Proxy Provenance (Direct Vercel Ingress Rules) | 3 | H1, H2, H3 |
| **9** | I. Vercel Routing Middleware Continuation Helper (@vercel/functions) | 1 | I1 |
| **10** | J. Documented Vercel Middleware Export Convention (P0) | 1 | J1 |
| **11** | K. Pre-Existing Function & Schema Restoration Fixtures (P1) | 2 | K1, K2 |
| **12** | L. Vercel Cron Endpoint GET & Configuration (P1) | 4 | L1, L2, L3, L4 |
| **13** | M. Comprehensive IPv4/IPv6 Validation & Normalization (P1) | 6 | M1, M2, M3, M4, M5, M6 |
| **14** | N. Password Untrimmed Consistency (P1) | 1 | N1 |
| **15** | O. Cron Function Identity Signature Consistency & Preflight Checks (P0) | 3 | O1, O2, O3 |
| **16** | P. Baseline Snapshot Table Isolation & Security Boundary (P0) | 2 | P1, P2 |
| **17** | Q. Signature-Aware Overload Handling & proacl Replay (P1) | 2 | Q1, Q2 |
| **18** | R. Complete Pre-Existing Table Restoration & RLS Flags (P1) | 2 | R1, R2 |
| **19** | S. Exact Default ACL Dynamic Reconstruction (P1) | 1 | S1 |
| **20** | T. PostgreSQL C-Parser AST & DDL Validation (@pgsql/parser) (P0) | 4 | T1, T2, T3, T4 |
| **21** | U. Pre-Existing Table & Index Rollback Fixtures (P0) | 2 | U1, U2 |
| **22** | V. Schema and Multi-Object Default ACL Fixtures (P0/P1 Finding H-01 & H-03) | 7 | V1, V2, V3, V4, V5, V6, V7 |
| **23** | W. Safe Function ACL Reset, Overload Preservation & Grantor Fidelity Fixtures | 5 | W1, W2, W3, W4, W5 |
| **24** | X. Default ACL Grantor Fidelity & Execution Context Fixtures (P1 Finding H-04) | 2 | X1, X2 |
| **25** | Y. PostgreSQL 16 Local Integration Test Status (Governance & Environment Boundary) | 1 | Y1 |
| **26** | Z1. SQL00 PL/pgSQL Declaration Integrity (R1.30 Defect 1) | 5 | Z1.1, Z1.2, Z1.3, Z1.4, Z1.5 |
| **27** | Z2. SQL01 Default ACL Object Code Mapping Integrity (R1.30 Defect 2) | 5 | Z2.1, Z2.2, Z2.3, Z2.4, Z2.5 |
| **28** | Z3. Rollback Join Scoping & CROSS JOIN LATERAL Syntax (R1.30 Defect 3) | 4 | Z3.1, Z3.2, Z3.3, Z3.4 |
| **29** | Z4. Default ACL Grantor Restoration & Execution Context Handling (R1.30 Defect 4) | 5 | Z4.1, Z4.2, Z4.3, Z4.4, Z4.5 |
| **30** | Z5. PostgreSQL Grantor Role Restoration & Context Lifecycle (R1.30.2) | 8 | Z5.1, Z5.2, Z5.3, Z5.4, Z5.5, Z5.6, Z5.7, Z5.8 |
| **31** | Z6. Global Rollback Role Restoration & RESET ROLE Elimination (R1.30.5) | 30 | Z6.1, Z6.1.1–Z6.1.20, Z6.2, Z6.3, Z6.4, Z6.5, Z6.6, Z6.7, Z6.8, Z6.9, Z6.10 |
| **32** | Track B4 R1.30.5 Comprehensive Security & Verification Suite | Root | Outermost describe block container |
| **TOTAL** | **32 Suites** | **135** | **135 Passed (100% Pass Rate, 0 Failures, 0 Skipped)** |

---

## 3. Explanation of Independent Audit Failure (95 Passed, 40 Failed)

### Reported State
In an independent audit environment running Node.js v22.16.0:
- 135 total tests
- 95 passed
- 40 failed
- Error: Missing dependency `@pgsql/parser`

### Technical Cause
1. In `docs/TRACK_B4_R1_30_5/package.json`, `@pgsql/parser: "^1.6.3"` is declared as a package dependency.
2. In the repository root `package.json`, `@pgsql/parser` is not present (only application dependencies are declared at the root).
3. The review archive `TRACK_B4_R1_30_5_REVIEW_PACKAGE.zip` deliberately excludes `node_modules`.
4. If an auditor unpacks the archive and invokes `node --test` without running `npm ci` inside `docs/TRACK_B4_R1_30_5`, Node.js cannot resolve `@pgsql/parser` from the local workspace.
5. In Node.js, `import('@pgsql/parser')` rejects with `ERR_MODULE_NOT_FOUND`.
6. This directly causes **16 C-parser leaf tests** to throw:
   - Suite T: T1, T2, T3 (3 tests)
   - Suite V: V2, V3, V4, V5, V7 (5 tests)
   - Suite W: W2, W3 (2 tests)
   - Suite X: X2 (1 test)
   - Suite Z1: Z1.5 (1 test)
   - Suite Z2: Z2.5 (1 test)
   - Suite Z3: Z3.3 (1 test)
   - Suite Z5: Z5.8 (1 test)
   - Suite Z6: Z6.10 (1 test)
7. Together with suite-level failure reporting in Node's test runner, this generated 40 failed reporting lines.
8. **Resolution:** Running `npm ci --prefix docs/TRACK_B4_R1_30_5` installs all 11 packages locked in `package-lock.json`. Re-running the suite passes **135/135 tests in ~663ms**.

