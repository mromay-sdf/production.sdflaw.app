# Reused SDF PDF engine

Source: neighboring `../PDF/src`, inspected and copied on 2026-09-29.

The files under `pdf`, `types`, and `utils` are unmodified source copies. `source-hashes.json` records their SHA-256 values. Existing `bates`, `coordinates`, and `merge` tests are included and run in Production's suite. The original app has not been changed.

Run `node scripts/verify-bates-source.mjs` to check this copy against its recorded hashes. Pass a sibling source path to compare upstream too:

```sh
node scripts/verify-bates-source.mjs ../PDF/src
```

Keep stamping/numbering changes in the original engine, then deliberately synchronize files and tests here. A future shared published package can replace these vendored files without changing the Production service boundary. Do not silently create divergent stamping logic in `server/workflow.ts`: that adapter is responsible for storage, integrity checks, output naming, limits, and transactional updates.

Adaptations occur outside this source: generated producer/creator metadata is changed to SDF Production after stamping because the inherited engine identifies local browser processing. No server-side privacy claim from the PDF application's UI is reused.
