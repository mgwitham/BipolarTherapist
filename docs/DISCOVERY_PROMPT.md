# Therapist Discovery Prompt

Canonical LLM prompt for producing seed CSV rows that pass the ingestion
pipeline cleanly. Scoped to a single California city plus a list of ZIP codes.

## How to run

```
npm run cms:discovery-prompt -- --city "Pasadena" --zips "91101,91103,91105" --count 10
```

Flags:

- `--city` (required) California metro or city name
- `--zips` (required) Comma-separated list of ZIP codes in that city
- `--count` (optional, default 10) How many candidate rows to request
- `--out` (optional, default `data/import/generated-discovery-prompt.md`)
  Where to write the filled prompt

The command writes a ready-to-paste prompt to the output file. Open it,
copy everything below the `---` divider, paste into Claude (or any LLM
with web search turned on), and wait for the CSV.

## How to use the LLM output

1. The LLM responds with a CSV block plus a reject list. Copy just the CSV
   (including the header row) into `data/import/therapist-source-seeds.csv`.
   Replace the file contents, don't append, unless you want to process an
   old batch at the same time.
2. Run the existing pipeline:
   ```
   npm run cms:get-more-therapists
   ```
3. Review the generated review queue at
   `data/import/generated-candidate-review-queue.md`.

## The prompt template

Lives at `docs/discovery-prompt.template.txt`. Placeholders:

- `{CITY}` replaced with the `--city` value
- `{ZIPS}` replaced with the `--zips` list
- `{N}` replaced with the `--count` value

Edit that file directly if you need to tune the prompt. Changes are
versioned alongside the pipeline so calibration doesn't drift.

## Calibration notes

Run the first batch with `--count 10`. Review all 10 by hand before
scaling up. Watch for two failure modes:

1. **False positives** — therapists listed with bipolar among many other
   specialties but who don't really focus on it. The prompt's rule 3(b)
   requires at least one of a dedicated page, a three-sentence clinical
   paragraph, named bipolar training, or bipolar-specific testimonials.
   If false positives still slip through, add more required signals to
   3(b) or raise the bar to "at least TWO of these" in
   `discovery-prompt.template.txt`.
2. **Over-rejection** — the prompt defaults to reject when 3(b) is
   unclear. If the LLM's reject list shows real specialists getting
   filtered out (check their sites), loosen 3(b) by adding softer
   signals or switching to "OR" logic between bullets.
3. **Aggregator leakage** — Psychology Today or similar URLs sneaking
   through. Add their domains to the hard exclusions and re-run.
