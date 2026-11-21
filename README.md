[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Kkajasd/csv-reader-speed-20261121/rank.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Kkajasd/csv-reader-speed-20261121/reward.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)

# csv-reader-speed-20261121

A faster drop-in for csv-reader 1.0.0. `solve.js` answers `{text, header}` with
exactly csv-reader's `{columns, rows, errors}` — same broken-CSV semantics
(stray CRs, quoted fields, doubled quotes, junk after a closing quote,
unterminated quotes, short and long rows, empty lines) — in a single pass.

## How it is fast

- Unquoted fields and quoted fields take `indexOf`-driven fast paths and are
  sliced, not built character by character.
- Only fields holding a CR, an escaped quote, or an embedded newline take a
  slow path, where `""` resolves to `"`, CR/CRLF inside quotes reads as LF,
  and lone CRs are dropped with a `stray_cr` error each.
- Parser state lives in locals; objects are created only for the error records
  the output requires.

## Measured on the practice set (6 cases, 10,645,596 bytes of CSV text)

- csv-reader baseline: ~1.1–1.4 s CPU per pass
- this entry: ~0.27–0.29 s CPU per pass (about 4x faster)
- both pass all 6 practice cases byte-identically against the reference

## Files

- `solve.js` — the parser (`run(input)`).
- `main.ts` — the driver: reads `/input/cases.json`, answers each case with
  `run`, writes `/output/answers.json`. Turns V8 incremental marking off
  before importing `solve.js`.
- `README.md` — this file.
- `LICENSE` — MIT.
