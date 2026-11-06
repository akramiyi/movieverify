# TRACK B4 R1.30.5 — R1.30.4 BASELINE COMPARISON & IMMUTABILITY AUDIT

**Release:** Track B4 R1.30.5  
**Baseline:** Track B4 R1.30.4 Independent Source Audit — STRICTLY IMMUTABLE  
**Mode:** STRICT READ-ONLY EVIDENCE AUDIT  
**Staging Status:** HOLD  
**Production Status:** HOLD

---

## 1. Immutable Baseline Artifacts (R1.30.4) & Corrected Checksum Labeling

To ensure absolute audit precision, the archive checksum, manifest content, and manifest file checksum are distinguished:

| Baseline Artifact | Path | Size | Checksum / Content | Description / Labeling |
| :--- | :--- | :--- | :--- | :--- |
| **R1.30.4 Review Archive** | `docs/TRACK_B4_R1_30_4_REVIEW_PACKAGE.zip` | 93,551 bytes | `15EDBABF51B0E04712B828AE4D63F0750A2589A5C065BD07AFFBA2120E1062B7` | **Archive SHA-256 Checksum** (Hash of the compressed ZIP archive) |
| **R1.30.4 Checksum Manifest Content** | `docs/TRACK_B4_R1_30_4_REVIEW_PACKAGE.zip.sha256` | 103 bytes | `15EDBABF51B0E04712B828AE4D63F0750A2589A5C065BD07AFFBA2120E1062B7  TRACK_B4_R1_30_4_REVIEW_PACKAGE.zip` | **Manifest Payload** (Text content stored inside the .sha256 file) |
| **R1.30.4 Checksum Manifest File** | `docs/TRACK_B4_R1_30_4_REVIEW_PACKAGE.zip.sha256` | 103 bytes | `6B49A877E6071764B4B09273B40DDD1DA693877C324E73862DD45E4AB07EEF59` | **Manifest File SHA-256** (Hash of the .sha256 text file itself) |
| **R1.30.4 Workspace** | `docs/TRACK_B4_R1_30_4/` | 28 files | — | **Workspace Directory** (Strictly immutable audit reference) |

---

## 2. Code Comparison: R1.30.4 vs R1.30.5

The delta between R1.30.4 and R1.30.5 is strictly confined to `RollbackSqlScanner` and its regression suite within `tests/track_b4/track_b4_security.test.js`:

### 2.1 Elimination of Prefix-Only Bypass
* **In R1.30.4:**
  `isTemplateProvenSafe(template)` checked whether a format string began with an allowed prefix:
  ```javascript
  // R1.30.4 VULNERABILITY: Prefix matching bypassed argument checks!
  const prefix = template.trim().toUpperCase();
  if (prefix.startsWith('GRANT ') || prefix.startsWith('REVOKE ')) return true;
  ```
  This allowed `EXECUTE format('GRANT %s', v_untrusted);` to pass as `clean: true`.

* **In R1.30.5:**
  `isTemplateProvenSafe()` was completely removed. All format calls are inspected placeholder-by-placeholder via `analyzeFormatCall(template, parsedArgs)`.

### 2.2 Placeholder-by-Placeholder Quoting Semantics
* **`%I` (Identifier):** Verified safe against statement escaping via PostgreSQL `quote_ident()` semantics (quotes as `"..."`, internal `"` doubled).
* **`%L` (Literal):** Verified safe against statement escaping via PostgreSQL `quote_literal()` semantics (quotes as `'...'`, internal `'` escaped).
* **`%s` (Raw Substitution):** Evaluated strictly. A raw substitution is ONLY safe if the corresponding argument is a statically proven literal. Any runtime variable or function return value causes `hasUnresolvedRawSubstitution = true` and records the statement in `result.unanalyzable`.

### 2.3 Strict Audit Mode
In strict audit mode (`failClosed: true`):
```javascript
if (strictAudit && result.unanalyzable.length > 0) {
  result.clean = false;
}
```
Whenever unanalyzable dynamic SQL statements remain, the scanner reports `clean: false`.

---

## 3. Preservation of Runtime `%s` as UNANALYZABLE

As mandated by Track B4 governance:
1. **Zero Runtime Assumptions:** Static code analysis does NOT certify runtime SQL safety without validating actual runtime values.
2. **Catalog of Unanalyzable Statements:** In `ROLLBACK_PLAN.md`, exactly 14 dynamic SQL statements rely on runtime `%s` substitutions (privilege types, constraint definitions, function definitions from baseline tables).
3. **Formal Classification:** All 14 expressions are cataloged in `result.unanalyzable`.
4. **Validation Status:** Dynamic SQL execution remains strictly **NOT VERIFIED**.
