# Vendored browser code

The Board and report pages inline these files, so they render with no network.

| File | Package | Version | Licence | Source |
| --- | --- | --- | --- | --- |
| `markdown-it-15.0.3.min.js` | [markdown-it](https://github.com/markdown-it/markdown-it) | 15.0.3 | MIT (`markdown-it.LICENSE`) | `dist/browser/markdown-it.umd.min.js` from the npm tarball `markdown-it-15.0.3.tgz` (tarball sha256 `98a7453983ab0e268c17dbd5260bf7190ba46b4cca912327fc1c1a2578e4b56d`, file sha256 `391f2aa638e75e6c7859d0a5c5650ef0956722a45998f17e05b83bc655778e1e`) |

The file is unmodified; the page drops its trailing `sourceMappingURL` comment when inlining. To upgrade, replace the file and licence, update this table and `MARKDOWN_IT` in `board_render.py`, then run the node tests (they exercise the sanitizer against the vendored build).
