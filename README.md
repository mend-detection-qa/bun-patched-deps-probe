# bun-patched-deps-probe

Mend SCA detection probe — Tier 4, entry #15.
Coverage plan entry: `docs/BUN_COVERAGE_PLAN.md` §11.4 entry #15

---

## Pattern bundle

- **D3** — `patchedDependencies` (Bun 1.1+ top-level `package.json` field, analogous to pnpm's `patchedDependencies`)
- **S5** — `patch:` protocol used directly as a dep value (e.g. `"is-even": "patch:is-even@1.0.0#./patches/is-even.patch"`)

---

## Why bundled

Both D3 and S5 exercise Bun's patch parser at scan time. They are the only two ways to declare a patch in Bun 1.1+, and both require Mend to recognize non-standard lockfile structures:

- **D3 (`patchedDependencies` field):** The patch declaration lives in the `workspaces[""].patchedDependencies` section of `bun.lock`. The `packages[]` entry for the patched package looks like a normal registry tuple — Mend must correlate the workspace-level patch key (`is-odd@3.0.1`) with the packages entry.
- **S5 (`patch:` protocol dep value):** The patch is embedded directly in the dep value string in `package.json` and in `bun.lock` as `"patch:is-even@1.0.0#./patches/is-even.patch"`. Bun generates a `patch` descriptor block inside the package tuple; the packages key itself encodes the full `patch:` URL.

A single probe exercises both so that a Mend parser gap affecting the shared patch-annotation code path surfaces in one scan, while keeping the two mechanisms distinguishable by their lockfile location.

---

## Patch mechanism table

| Mechanism | §3 ID | `package.json` declaration | `bun.lock` location | Dep using it |
|---|---|---|---|---|
| Top-level `patchedDependencies` field | D3 | `"patchedDependencies": { "is-odd@3.0.1": "patches/is-odd.patch" }` | `workspaces[""].patchedDependencies` | `is-odd@3.0.1` |
| `patch:` protocol on dep value | S5 | `"is-even": "patch:is-even@1.0.0#./patches/is-even.patch"` | `packages["is-even"]` tuple with `"patch"` descriptor block | `is-even@1.0.0` |

Both mechanisms leave the resolved package version unchanged — `is-odd` remains `3.0.1`, `is-even` remains `1.0.0`. Patches modify file content at install time but do not shift the package version identifier.

---

## Dependency graph

```
bun-patched-deps-probe
├── is-odd@3.0.1 (direct, PATCHED via patchedDependencies — MECHANISM 1)
│   └── is-number@6.0.0 (transitive, registry, no further deps)
└── is-even@1.0.0 (direct, PATCHED via patch: protocol — MECHANISM 2)
    └── is-odd@0.1.2 (transitive, registry — distinct from root is-odd@3.0.1)
        └── is-number@3.0.0 (transitive)
            └── kind-of@3.2.2 (transitive)
                └── is-buffer@1.1.6 (transitive, no further deps)
```

Direct: 2, Transitive: 6, Total: 8.

Note: two distinct `is-odd` entries coexist — `is-odd@3.0.1` (patched direct dep) and `is-odd@0.1.2` (unpatched transitive of `is-even`). Mend must not collapse these.

---

## Mend config

No `.whitesource` file is emitted for this probe.

Bun is NOT in Mend's `install-tool` supported list. The `scanSettings.versioning` mechanism in `.whitesource` cannot pin a Bun toolchain version — emitting a `.whitesource` with a `bun` key would be silently ignored. Detection is entirely lockfile-driven: Mend reads `bun.lock` (text JSONC) statically, without invoking `bun install`.

This limitation is documented in `docs/BUN_COVERAGE_PLAN.md` edge-case probe #24 (`bun-not-in-install-tool-probe`).

---

## What Mend must detect

| Assertion | Expected | Common failure |
|---|---|---|
| `is-odd` source | `registry` | Correct — no source-type failure expected |
| `is-odd` patch annotated | `source_detail.patch_applied: true`, `patch_mechanism: "patchedDependencies-field"` | Annotation absent — patch field ignored |
| `is-even` source | `registry` | `unknown` or dep dropped — `patch:` protocol not parsed |
| `is-even` patch annotated | `source_detail.patch_applied: true`, `patch_mechanism: "patch-protocol-dep-value"` | Annotation absent — `patch:` descriptor ignored |
| `is-odd@3.0.1` version | `3.0.1` | Correct — patch does not shift version |
| `is-even@1.0.0` version | `1.0.0` | Correct — patch does not shift version |
| Dual `is-odd` entries | Both `is-odd@3.0.1` and `is-odd@0.1.2` present | `is-odd@0.1.2` collapsed into `is-odd@3.0.1` |
| Transitive depth | 4 levels under `is-even` | Chain cut short — transitive walking broken from patched dep |
| `project_metadata.patched_dependencies` | Both mechanisms recorded | Object absent or empty |
| Direct count | 2 | 1 (if `is-even` dropped due to unrecognized `patch:` protocol) |
| Total count | 8 | 2 (if all transitives of `is-even` dropped) |

---

## Failure modes

**Failure A — patch fields ignored (most likely):**
Mend treats `is-odd` and `is-even` as plain registry packages. The dep tree is structurally correct (names, versions, transitive edges all present) but no patch annotation appears in `source_detail`. Security teams auditing patched packages cannot distinguish patched from unpatched deps. `project_metadata.patched_dependencies` is absent or empty.

**Failure B — `patch:` protocol dropped:**
Mend does not recognize `"patch:is-even@1.0.0#./patches/is-even.patch"` as a valid dep-value protocol. `is-even` is dropped from the dep tree entirely. Direct dep count drops to 1 and the five transitives reachable only through `is-even` (`is-odd@0.1.2`, `is-number@3.0.0`, `kind-of@3.2.2`, `is-buffer@1.1.6`) are also missing.

**Failure C — JSONC parsing crash:**
The `bun.lock` file contains inline `//` comments and trailing commas. If Mend's parser does not tolerate JSONC syntax, the entire lockfile fails to parse and the dep tree is empty. This failure is shared with all other Bun 1.1+ text-lockfile probes.

---

## Resolver notes (UA JavaScript resolver analog)

Bun is NOT a UA-supported resolver. The UA JavaScript resolver (`JSDependencyResolver`) handles npm, Yarn, and pnpm — selection is based on which lockfile is present. There is no `bun.lock` parser in the documented resolver chain. Mend's detection of `bun.lock` is therefore exploratory — the npm resolver may be applied as a fallback and will almost certainly fail to recognize:
- The `patchedDependencies` key in the `workspaces` section (npm lock v3 has no equivalent)
- The `patch` descriptor block inside package tuples (novel to Bun)
- The `patch:` protocol key format in the `packages` map

This probe is explicitly a **regression probe for a known gap** — it documents what Mend SHOULD emit (the correct tree with patch annotations) and what it WILL emit (plain registry deps with no patch annotations, or `is-even` dropped entirely).

---

## File inventory

| File | Purpose |
|---|---|
| `package.json` | Root manifest with both `patchedDependencies` field and `patch:` protocol dep |
| `bun.lock` | Text JSONC lockfile (Bun 1.1.30); encodes both patch mechanisms |
| `patches/is-odd.patch` | Stub unified-diff patch for `is-odd` (MECHANISM 1) |
| `patches/is-even.patch` | Stub unified-diff patch for `is-even` (MECHANISM 2) |
| `index.ts` | Minimal TypeScript stub; not executed by Mend |
| `expected-tree.json` | Schema v1.0 expected dep tree with patch annotations and failure-mode docs |
| `README.md` | This file |

---

## Probe metadata

| Field | Value |
|---|---|
| Patterns covered | D3 (`patchedDependencies` field) + S5 (`patch:` protocol dep value) |
| `pm_version_tested` | `1.1.30` |
| Direct deps | 2 (`is-odd@3.0.1` patched via D3, `is-even@1.0.0` patched via S5) |
| Transitive deps | 6 |
| Total deps | 8 |
| `.whitesource` emitted | No — Bun not in install-tool list |
| Target | local |

---

Tracked in: `docs/BUN_COVERAGE_PLAN.md` §11.4 entry #15