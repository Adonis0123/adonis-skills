# Glossary

**Request Brief**:
The user's request plus the assumed defaults (use, aspect ratio, subject, style, and for video the duration). Defaults are stated in the same message as the search; they are not a turn of questions. For a Code Video it follows the Hyperframes spec fields; write a number wherever you would have written an adjective.

**Generation Brief**:
The rewritten prompt a Channel runs (`content`: structure kept, subject replaced, Style Pack applied, adapted to the target model), plus parameters and reference images. The file `studio.mjs brief` writes is the provenance record around that prompt.
_Avoid_: prompt file, job

**Channel**:
The tool or service that actually generates: the host's own tool, another agent CLI, an HTTP API, or a render engine. This skill is never a Channel.
_Avoid_: provider, backend

**Style Pack**:
A user-provided file of style constraints: palette, banned elements, character references, aspect-ratio presets and checks. Without one, no house style is added.
_Avoid_: theme, brand config

**Code Video**:
A video whose frames are rendered from code an LLM wrote; every word and number on screen is exact.

**Model Video**:
A video a generation model produces from a prompt and reference images; realistic, not exactly controllable, billed by the second.

**Source**:
One GitHub prompt library plugged into search through an adapter, with its license and seed policy (`assets/sources.json`, or `user-sources.json` for ones the user added).
_Avoid_: repo, provider

**Kind**:
What a candidate is for: `image`, `video` (a video model) or `code-video` (a template or example rendered from code).

**Recommendation List**:
The 5 candidates (up to 9 on request) shown after `recommend`, each with a sample image or clip, the model that made it, author, source and license, one of them marked as the default.

**Run Record**:
One line per generation, including the user's score; scores feed back into later rankings.
