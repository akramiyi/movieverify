# TRACK B4 R1.30.5 — CANONICAL TRACK B2 VERIFICATION EVIDENCE

**Release:** Track B4 R1.30.5  
**Baseline:** Track B4 R1.30.4 (Strictly Immutable)  
**Operating Mode:** STRICT READ-ONLY EVIDENCE AUDIT  
**Track B2 Status:** FROZEN — 100% BIT-FOR-BIT UNCHANGED

---

## 1. Canonical Reference Hashes vs Local Workspace & Evidence Copies

Track B2 notification database files were frozen under Track B2 governance. Under Track B4 governance, zero changes, additions, deletions, or whitespace modifications are permitted.

The table below documents the bit-for-bit SHA-256 match across all copies:

| Canonical Track B2 File | Canonical Reference SHA-256 | Local File on Disk (`tests/db/`) | Evidence Package File (`canonical_b2/`) | Verification Status |
| :--- | :--- | :--- | :--- | :--- |
| `20261102_harden_notifications_consolidated.sql` | `B988261008CB9500CA7B40E0A43C4AADAD8CE4C69B407EACDA1637D6D0BCC81A` | `B988261008CB9500CA7B40E0A43C4AADAD8CE4C69B407EACDA1637D6D0BCC81A` | `B988261008CB9500CA7B40E0A43C4AADAD8CE4C69B407EACDA1637D6D0BCC81A` | **MATCH / FROZEN** |
| `production_preflight_inspection_v2.sql` | `77E707E024F9D2D705923F9BC0DA6F688FE43E709BFCB02889F22F1F04ED5ED4` | `77E707E024F9D2D705923F9BC0DA6F688FE43E709BFCB02889F22F1F04ED5ED4` | `77E707E024F9D2D705923F9BC0DA6F688FE43E709BFCB02889F22F1F04ED5ED4` | **MATCH / FROZEN** |
| `rollback_notifications.sql` | `E6D303AB9E53C7BF5E10FFB1C8129A043F432D96242A0BF5DCDAA64A95062004` | `E6D303AB9E53C7BF5E10FFB1C8129A043F432D96242A0BF5DCDAA64A95062004` | `E6D303AB9E53C7BF5E10FFB1C8129A043F432D96242A0BF5DCDAA64A95062004` | **MATCH / FROZEN** |

---

## 2. Independent Verification Instructions

To verify the SHA-256 hashes of the canonical Track B2 SQL files:

### Windows PowerShell:
```powershell
Get-FileHash docs/TRACK_B4_R1_30_5_EVIDENCE/canonical_b2/* -Algorithm SHA256
```

### Unix / Linux / macOS (shasum):
```bash
shasum -a 256 docs/TRACK_B4_R1_30_5_EVIDENCE/canonical_b2/*.sql
```

Expected outputs:
```text
B988261008CB9500CA7B40E0A43C4AADAD8CE4C69B407EACDA1637D6D0BCC81A  20261102_harden_notifications_consolidated.sql
77E707E024F9D2D705923F9BC0DA6F688FE43E709BFCB02889F22F1F04ED5ED4  production_preflight_inspection_v2.sql
E6D303AB9E53C7BF5E10FFB1C8129A043F432D96242A0BF5DCDAA64A95062004  rollback_notifications.sql
```

