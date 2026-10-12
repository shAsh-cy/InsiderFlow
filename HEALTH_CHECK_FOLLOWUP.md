# InsiderFlow Health Check Follow-Up Report

**Date:** 2026-10-13  
**Branch:** `chore/health-check-followup`  
**Base:** `chore/health-check-resume` @ `e12c324`  
**Status:** In Progress — Awaiting Docker Desktop startup for Task 2

---

## 1. Independent Re-Verification of CVE Fix

### 1.1 `pnpm audit --prod` (Production Scope)

**Command:**

```bash
pnpm audit --prod
```

**Full Verbatim Output:**

```text
No known vulnerabilities found
```

**Exit code:** `0`

---

### 1.2 `pnpm audit` (Both Scopes / Unscoped)

**Command:**

```bash
pnpm audit
```

**Full Verbatim Output:**

```text
┌─────────────────────┬────────────────────────────────────────────────────────┐
│ moderate            │ Vitest: Path Traversal / Arbitrary File Read via       │
│                     │ @vitest/mocker Redirect Mock                           │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Package             │ vitest                                                 │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Vulnerable versions │ >=2.1.0 <4.1.11                                        │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Patched versions    │ >=4.1.11                                               │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Paths               │ apps__web>vitest                                       │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ More info           │ https://github.com/advisories/GHSA-82fw-gwwq-j7x9      │
└─────────────────────┴────────────────────────────────────────────────────────┘
┌─────────────────────┬────────────────────────────────────────────────────────┐
│ moderate            │ Vitest: Path Traversal / Arbitrary File Read via       │
│                     │ @vitest/mocker Redirect Mock                           │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Package             │ @vitest/mocker                                         │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Vulnerable versions │ >=2.1.0 <4.1.11                                        │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Patched versions    │ >=4.1.11                                               │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Paths               │ apps__web>vitest>@vitest/mocker                        │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ More info           │ https://github.com/advisories/GHSA-82fw-gwwq-j7x9      │
└─────────────────────┴────────────────────────────────────────────────────────┘
3 vulnerabilities found
Severity: 2 moderate | 1 high (1 ignored)
```

**Exit code:** `1`

---

### 1.3 `osv-scanner --lockfile=pnpm-lock.yaml`

**Binary:** `osv-scanner v2.2.4` (matching `.github/workflows/supply-chain.yml:59`)  
**Command:**

```bash
osv-scanner --lockfile=pnpm-lock.yaml
```

**Full Verbatim Output:**

```text
Scanned C:\Users\HP\insiderflow\pnpm-lock.yaml file and found 849 packages
Total 3 packages affected by 3 known vulnerabilities (0 Critical, 1 High, 2 Medium, 0 Low, 0 Unknown) from 1 ecosystem.
2 vulnerabilities can be fixed.

+-------------------------------------+------+-----------+----------------+---------+---------------+----------------+
| OSV URL                             | CVSS | ECOSYSTEM | PACKAGE        | VERSION | FIXED VERSION | SOURCE         |
+-------------------------------------+------+-----------+----------------+---------+---------------+----------------+
| https://osv.dev/GHSA-82fw-gwwq-j7x9 | 5.9  | npm       | @vitest/mocker | 3.2.7   | 4.1.11        | pnpm-lock.yaml |
| https://osv.dev/GHSA-vfj7-8cjw-p6xm | 8.7  | npm       | braces         | 3.0.3   | --            | pnpm-lock.yaml |
| https://osv.dev/GHSA-82fw-gwwq-j7x9 | 5.9  | npm       | vitest         | 3.2.7   | 4.1.11        | pnpm-lock.yaml |
+-------------------------------------+------+-----------+----------------+---------+---------------+----------------+
```

**Exit code:** `1`

---

### 1.4 CVE Confirmation & Analysis

1. **Critical Next.js RCEs Specifically Verified Absent:**
   - `GHSA-p293-qw3h-jr36` (Critical, Next.js Server Components RCE): **CONFIRMED NOT PRESENT** in both `pnpm audit` and `osv-scanner`.
   - `GHSA-2xp9-vwfh-vxw4` (Critical, Next.js Middleware / Route Cache RCE): **CONFIRMED NOT PRESENT** in both `pnpm audit` and `osv-scanner`.
   - Next.js 15.5.27 cleanly resolved both criticals and the two moderates (`GHSA-4jqv-mc3x-m676`, `GHSA-mcj8-r9mp-w47p`).
2. **Sharp, source-map-js, and undici Vulnerabilities Specifically Verified Absent:**
   - `sharp` (`GHSA-rgj7-g3m4-5g8c`, `GHSA-wq5f-xc86-pv6w`): **CONFIRMED NOT PRESENT** (resolved by `^0.35.5`).
   - `source-map-js` (`GHSA-68fv-2mgg-jv7q`): **CONFIRMED NOT PRESENT** (resolved by `^1.2.2`).
   - `undici` (`GHSA-r53p-7pc4-xj5r`, `GHSA-2gqq-gqf2-x968`, `GHSA-8436-99hf-9mmv`): **CONFIRMED NOT PRESENT** (resolved by `>=7.29.1`).
3. **Database Consistency:**
   - Both npm advisory database (via `pnpm audit`) and OSV database (via `osv-scanner`) report **0 Critical vulnerabilities**.
   - Production scope (`pnpm audit --prod`) has **0 vulnerabilities** of any severity.
   - The remaining findings in devDependencies are:
     - `braces 3.0.3` (GHSA-vfj7-8cjw-p6xm / CVE-2026-93687): unpatched upstream (`FIXED VERSION: --`) in devDependency of `@next/eslint-plugin-next`, ignored via `auditConfig.ignoreCves`.
     - `vitest 3.2.7` / `@vitest/mocker 3.2.7` (GHSA-82fw-gwwq-j7x9): moderate severity test runner mock redirection advisory in devDependencies.
