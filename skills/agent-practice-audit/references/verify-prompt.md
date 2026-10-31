# Verifier prompt

Refresh mode sends this prompt to each independent verifier (a different model from the one that proposed the candidate). `scripts/consensus.py run` groups candidates by source page and sends one prompt per (page, verifier): the page text once plus every candidate that cites the page. `scripts/consensus.py prompt` fills the placeholders for a single candidate; everything after the template marker is sent.

Each candidate in the prompt lists `check_sources` (its sources on this page; only these are checked here) and, when it cites other pages too, `quotes_on_other_pages` (checked in another prompt, shown as context for `faithful` and `rule_faithful`). A candidate citing several pages gets one answer per page; `run` combines them, and the candidate is accepted by a verifier only if every page's answer is a valid accept.

Decision rule applied by `scripts/consensus.py`: accept iff agree >= 2 AND agree > total / 2 AND no veto. Every verifier that ran counts toward `total`; a malformed or unparseable answer counts and never agrees. A valid accept needs `quote_found`, `faithful` and `checkable` as real JSON booleans, all `true`; when the candidate has a `rule`, it also needs `rule_faithful: true`. Any answer with `quote_found: false` vetoes the candidate, even if the rest of that answer is malformed. A batch answer that is not a JSON array with exactly one object per candidate id (unknown, duplicate or missing ids) makes every candidate in that batch malformed for that verifier. Fewer than 2 verifiers -> `pending-consensus`.

<!-- template -->

You are verifying candidate "best practices" for coding agents before they are added to a curated list. Every candidate below cites the same source page. Judge only from the source text at the end. Do not use outside knowledge, and do not browse.

Source basis: {{BASIS}} ("live" = text fetched from the official page; "digest" = a stored summary plus verbatim quotes, used because the page could not be opened).

Candidates (JSON array):

<<<CANDIDATES
{{CANDIDATES_JSON}}
CANDIDATES>>>

For each candidate, check every entry in its `check_sources`:

1. quote_found: does the quote appear in the source text word for word? Ignore differences in whitespace, curly vs straight quotes, and inline code formatting. An ellipsis (…) may stand for omitted words. Anything else that differs means false.
2. faithful: does the practice title say what the quote says (together with any `quotes_on_other_pages`), without adding conditions, dropping limits, or turning a description into a recommendation?
3. checkable: can someone tell from session logs or agent configuration whether a user follows it (as described in `detect`)? A practice that is honestly marked as usually not measurable can still be checkable = true if the `detect` text says how a person could check it.
4. rule_faithful (only when the candidate has a `rule`): does `rule.text` follow from the quotes and the source text? It must measure what the quote recommends and must not reverse or overstate it. A number in a rule that ends with "(heuristic)" is the list's own threshold and need not appear on the page; any other number must. For a candidate without a `rule`, use null.

Answer with one JSON array and nothing else: no prose, no code fence. Give exactly one object per candidate, in any order, with its `id` copied exactly. Use real JSON booleans (`true`/`false`, never strings).

[{"id": "<candidate id>", "verdict": "accept" | "reject", "quote_found": true | false, "faithful": true | false, "checkable": true | false, "rule_faithful": true | false | null, "reason": "one or two sentences; name the source and the mismatch if any"}]

Use "accept" only when every check is true for every entry in `check_sources` (and rule_faithful is true when there is a rule).

Example for three candidates (the first has a heuristic rule, the second has none, the third misquotes):

[{"id": "ctx-clear-between-tasks", "verdict": "accept", "quote_found": true, "faithful": true, "checkable": true, "rule_faithful": true, "reason": "Quote is in the 'Manage context' section; the 200-tool threshold is marked heuristic and matches the advice to clear between tasks."},
{"id": "doc-keep-agents-md-short", "verdict": "reject", "quote_found": true, "faithful": false, "checkable": true, "rule_faithful": null, "reason": "The page describes short files as an option; the title turns it into a requirement."},
{"id": "plan-mode-first", "verdict": "reject", "quote_found": false, "faithful": false, "checkable": true, "rule_faithful": false, "reason": "The quoted sentence is not on the page; the closest text says 'use plan mode for complex changes'."}]

Source text:
<<<SOURCE
{{PAGE_TEXT}}
SOURCE>>>
