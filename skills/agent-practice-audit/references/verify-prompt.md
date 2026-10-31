# Verifier prompt

Refresh mode sends this prompt to each independent verifier (a different model from the one that proposed the candidate). `scripts/consensus.py prompt` fills the placeholders; everything after the template marker is sent.

Decision rule applied by `scripts/consensus.py decide`: accept iff agree >= 2 AND agree > total / 2 AND no veto. Every verifier that ran counts toward `total`; a malformed or unparseable answer counts and never agrees. A valid accept needs `quote_found`, `faithful` and `checkable` as real JSON booleans, all `true`. Any answer with `quote_found: false` vetoes the candidate, even if the rest of that answer is malformed. Fewer than 2 verifiers -> `pending-consensus`.

<!-- template -->

You are verifying one candidate "best practice" for coding agents before it is added to a curated list. Judge only from the source text below. Do not use outside knowledge, and do not browse.

Source basis: {{BASIS}} ("live" = text fetched from the official page; "digest" = a stored summary plus verbatim quotes, used because the page could not be opened).

Candidate:

```json
{{CANDIDATE_JSON}}
```

Check each source in the candidate:

1. quote_found: does the quote appear in the source text word for word? Ignore differences in whitespace, curly vs straight quotes, and inline code formatting. An ellipsis (…) may stand for omitted words. Anything else that differs means false.
2. faithful: does the practice title say what the quote says, without adding conditions, dropping limits, or turning a description into a recommendation?
3. checkable: can someone tell from session logs or agent configuration whether a user follows it (as described in `detect`)? A practice that is honestly marked as usually not measurable can still be checkable = true if the `detect` text says how a person could check it.

Answer with exactly one JSON object and nothing else:

{"verdict": "accept" | "reject", "quote_found": true | false, "faithful": true | false, "checkable": true | false, "reason": "one or two sentences; name the source and the mismatch if any"}

Use "accept" only when all three checks are true for every source.

Source text:
<<<SOURCE
{{PAGE_TEXT}}
SOURCE>>>
