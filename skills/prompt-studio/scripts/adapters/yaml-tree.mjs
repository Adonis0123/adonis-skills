// yaml-tree adapter: a GitHub repo that keeps one YAML file per prompt, such
// as ai-boost/awesome-image-video-prompts (prompts/<kind>/<id>.yaml plus
// previews/<id>.jpg).
//
// sync() asks the cheap git ref API for the branch head SHA (ETag, so an
// unchanged repo costs a 304). Only when the SHA moved, or nothing is cached
// yet, it downloads the branch tarball once, reads it in memory (gunzip plus
// a minimal ustar reader), parses the YAML files matched by `include`, writes
// <dir>/entries.json and deletes the tarball. load() reads entries.json only.
//
// Zero dependencies. Fetched content is parsed as data: it is never executed
// and no tar member is ever written to disk.
//
// Registry options: repo, branch, kinds, include (globs, default **/*.yaml),
// previewBase (folder holding <id>.<image ext> previews), locale (title and
// notes language, default "en").
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const ENTRIES_FILE = "entries.json";
export const REF_FILE = "ref.json";
export const TARBALL_FILE = "repo.tar.gz";
const FORMAT = 1;
const MAX_YAML_BYTES = 1 << 20;
const MAX_TAR_BYTES = 512 * 1024 * 1024;

// ---------- small helpers ----------

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value)}\n`);
  fs.renameSync(tmp, file);
}

const isObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);

export function globToRegExp(glob) {
  let re = "";
  for (let k = 0; k < glob.length; k++) {
    const ch = glob[k];
    if (ch === "*" && glob[k + 1] === "*") {
      if (glob[k + 2] === "/") {
        re += "(?:.*/)?";
        k += 2;
      } else {
        re += ".*";
        k += 1;
      }
    } else if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

// ---------- YAML subset ----------

export class YamlSubsetError extends Error {
  constructor(message, line) {
    super(line ? `line ${line}: ${message}` : message);
    this.name = "YamlSubsetError";
    this.line = line || null;
  }
}

const ESCAPES = {
  0: "\0",
  a: "\x07",
  b: "\b",
  t: "\t",
  "\t": "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  e: "\x1b",
  " ": " ",
  '"': '"',
  "/": "/",
  "\\": "\\",
  N: "\u0085",
  _: "\u00a0",
  L: "\u2028",
  P: "\u2029",
};
const HEX_ESCAPES = { x: 2, u: 4, U: 8 };

function typedPlain(s) {
  if (/^(?:~|null|Null|NULL)$/.test(s)) return null;
  if (/^(?:true|True|TRUE)$/.test(s)) return true;
  if (/^(?:false|False|FALSE)$/.test(s)) return false;
  if (/^[-+]?(?:0|[1-9][0-9]*)$/.test(s)) {
    const v = Number(s);
    return Number.isSafeInteger(v) ? v : s;
  }
  if (/^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/.test(s))
    return Number(s);
  return s;
}

function foldLines(lines) {
  let out = "";
  let empties = 0;
  let prevMore = false;
  let started = false;
  for (const line of lines) {
    if (line === "") {
      empties++;
      continue;
    }
    const more = line[0] === " " || line[0] === "\t";
    if (!started) out += "\n".repeat(empties);
    else if (more || prevMore) out += "\n".repeat(empties + 1);
    else out += empties ? "\n".repeat(empties) : " ";
    out += line;
    started = true;
    prevMore = more;
    empties = 0;
  }
  return out;
}

function stripComment(s) {
  const m = /(^|[ \t])#/.exec(s);
  return (m ? s.slice(0, m.index) : s).trimEnd();
}

// Strict YAML subset, enough for one-file-per-entry prompt libraries:
// - one document (an optional leading `---`, an optional trailing `...`);
// - block mappings with plain or quoted keys, nested by indentation;
// - block sequences, including the compact form under a key at the same
//   indent, items that are scalars, mappings (`- key: v`) or sequences;
// - block scalars `|` and `>` with chomping (`-`/`+`) and an indent digit;
// - plain scalars (multi-line folding; null, booleans and numbers typed),
//   'single' and "double" quoted strings over several lines, with every
//   YAML double-quote escape and `\` line continuation;
// - one-line flow sequences of scalars (`[a, "b"]`) and empty `{}`;
// - full-line and trailing `#` comments.
// Anything else (anchors, aliases, tags, `?` complex keys, flow mappings,
// multi-line flow collections, directives, several documents, tab
// indentation, duplicate keys) throws YamlSubsetError; callers skip the file.
export function parseYamlSubset(text) {
  const lines = String(text)
    .replace(/^\ufeff/, "")
    .split(/\r\n|\r|\n/);
  // A final line break ends the last line; it does not open an empty one.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const n = lines.length;
  let i = 0;

  const fail = (message, at = i) => {
    throw new YamlSubsetError(message, Math.min(at, n - 1) + 1);
  };
  const isBlank = (k) => /^[ \t]*$/.test(lines[k]);
  const isNoise = (k) => isBlank(k) || /^[ \t]*#/.test(lines[k]);
  const isDocMarker = (k) => /^(?:---|\.\.\.)(?:[ \t]|$)/.test(lines[k]);
  const skipNoise = () => {
    while (i < n && isNoise(i)) i++;
  };
  const leadIndent = (k) => {
    const line = lines[k];
    let sp = 0;
    while (line[sp] === " ") sp++;
    if (line[sp] === "\t") fail("tabs are not allowed in indentation", k);
    return sp;
  };

  // Scan a quoted scalar on line `s` from `start` (just after the opening
  // quote). Returns the decoded text, the index after the closing quote (-1
  // when the line ends first), whether the line ended with an escaped line
  // break, and how much of `out` is left once unescaped trailing whitespace
  // is dropped.
  function scanQuoted(s, start, q) {
    let out = "";
    let keep = 0;
    for (let j = start; j < s.length; ) {
      const ch = s[j];
      if (q === "'" && ch === "'") {
        if (s[j + 1] === "'") {
          out += "'";
          keep = out.length;
          j += 2;
          continue;
        }
        return { out, keep: out.length, end: j + 1, escapedBreak: false };
      }
      if (q === '"' && ch === '"')
        return { out, keep: out.length, end: j + 1, escapedBreak: false };
      if (q === '"' && ch === "\\") {
        if (j + 1 === s.length)
          return { out, keep, end: -1, escapedBreak: true };
        const e = s[j + 1];
        if (Object.prototype.hasOwnProperty.call(ESCAPES, e)) {
          out += ESCAPES[e];
          j += 2;
        } else if (HEX_ESCAPES[e]) {
          const hex = s.slice(j + 2, j + 2 + HEX_ESCAPES[e]);
          const cp = parseInt(hex, 16);
          if (
            hex.length !== HEX_ESCAPES[e] ||
            !/^[0-9a-fA-F]+$/.test(hex) ||
            cp > 0x10ffff
          )
            fail(`bad escape \\${e}${hex}`);
          out += String.fromCodePoint(cp);
          j += 2 + hex.length;
        } else fail(`unknown escape \\${e}`);
        keep = out.length;
        continue;
      }
      out += ch;
      j++;
      if (ch !== " " && ch !== "\t") keep = out.length;
    }
    return { out, keep, end: -1, escapedBreak: false };
  }

  // `key: rest` on a line, or null when the text is not a mapping entry.
  function splitKey(text) {
    if (text === "?" || /^\?[ \t]/.test(text))
      fail("complex keys (?) are not supported");
    let key;
    let after;
    if (text[0] === '"' || text[0] === "'") {
      const q = scanQuoted(text, 1, text[0]);
      if (q.end < 0) return null;
      const m = /^[ \t]*:(?:[ \t]|$)/.exec(text.slice(q.end));
      if (!m) return null;
      key = q.out;
      after = text.slice(q.end + m[0].length);
    } else {
      let k = -1;
      for (let j = 0; j < text.length; j++) {
        if (text[j] === "#" && j > 0 && /[ \t]/.test(text[j - 1])) break;
        if (
          text[j] === ":" &&
          (j + 1 === text.length || text[j + 1] === " " || text[j + 1] === "\t")
        ) {
          k = j;
          break;
        }
      }
      if (k <= 0) return null;
      key = text.slice(0, k).trimEnd();
      if (/^[[\]{},#|>%@`]/.test(key)) return null;
      if (/^[&*!]/.test(key))
        fail("anchors, aliases and tags are not supported");
      if (/^-(?:[ \t]|$)/.test(key)) return null;
      after = text.slice(k + 1);
    }
    if (key === "__proto__") fail("the key __proto__ is not allowed");
    return { key, rest: after.replace(/^[ \t]+/, "") };
  }

  // A node whose first line `i` sits at column `ind`.
  function parseBlock(ind, parentIndent) {
    const text = lines[i].slice(ind);
    if (/^-(?:[ \t]|$)/.test(text)) return parseSeq(ind);
    if (splitKey(text)) return parseMap(ind);
    return parseValue(text, parentIndent, false);
  }

  function parseMap(ind) {
    const map = {};
    for (;;) {
      skipNoise();
      if (i >= n || (ind === 0 && isDocMarker(i))) break;
      const li = leadIndent(i);
      if (li < ind) break;
      if (li > ind) fail("unexpected indentation");
      const text = lines[i].slice(ind);
      const kv = splitKey(text);
      if (!kv) {
        if (/^-(?:[ \t]|$)/.test(text))
          fail("a sequence item where a mapping key was expected");
        fail("expected a `key: value` line");
      }
      if (Object.prototype.hasOwnProperty.call(map, kv.key))
        fail(`duplicate key "${kv.key}"`);
      map[kv.key] = parseValue(kv.rest, ind, true);
    }
    return map;
  }

  function parseSeq(ind) {
    const arr = [];
    for (;;) {
      skipNoise();
      if (i >= n || (ind === 0 && isDocMarker(i))) break;
      const li = leadIndent(i);
      if (li < ind) break;
      if (li > ind) fail("unexpected indentation");
      const text = lines[i].slice(ind);
      if (!/^-(?:[ \t]|$)/.test(text)) break;
      const rest = text.slice(1).replace(/^[ \t]+/, "");
      if (rest === "" || rest[0] === "#") {
        arr.push(parseNested(ind, false));
        continue;
      }
      const col = ind + text.length - rest.length;
      if (/^-(?:[ \t]|$)/.test(rest) || splitKey(rest)) {
        // View the item body as a block that starts at its own column.
        lines[i] = " ".repeat(col) + rest;
        arr.push(parseBlock(col, ind));
      } else arr.push(parseValue(rest, ind, false));
    }
    return arr;
  }

  // The value of `key:` or `-` with nothing after it on the line.
  function parseNested(parentIndent, allowCompactSeq) {
    i++;
    skipNoise();
    if (i >= n || isDocMarker(i)) return null;
    const li = leadIndent(i);
    if (li > parentIndent) return parseBlock(li, parentIndent);
    if (
      allowCompactSeq &&
      li === parentIndent &&
      /^-(?:[ \t]|$)/.test(lines[i].slice(li))
    )
      return parseSeq(li);
    return null;
  }

  // The scalar or nested node that starts with `rest` on line i.
  function parseValue(rest, parentIndent, inMap) {
    if (rest === "" || rest[0] === "#") return parseNested(parentIndent, inMap);
    const c = rest[0];
    if (c === "|" || c === ">") return parseBlockScalar(rest, parentIndent);
    if (c === '"' || c === "'") return parseQuoted(rest, parentIndent);
    if (c === "[" || c === "{") return parseFlow(rest);
    if (c === "&" || c === "*" || c === "!")
      fail("anchors, aliases and tags are not supported");
    if (
      c === "%" ||
      c === "@" ||
      c === "`" ||
      c === "," ||
      c === "]" ||
      c === "}"
    )
      fail(`a plain value cannot start with "${c}"`);
    if (c === "?" && /^\?(?:[ \t]|$)/.test(rest))
      fail("complex keys (?) are not supported");
    if (c === "-" && /^-(?:[ \t]|$)/.test(rest))
      fail("a sequence cannot start on a mapping key line");
    return parsePlain(rest, parentIndent);
  }

  function parsePlain(rest, parentIndent) {
    const first = stripComment(rest);
    if (/:(?:[ \t]|$)/.test(first)) fail("`: ` inside a plain value; quote it");
    const ended = first.length < rest.trimEnd().length; // a comment ends it
    let out = first.trim();
    let multi = false;
    i++;
    if (!ended) {
      let blanks = 0;
      while (i < n) {
        if (isBlank(i)) {
          blanks++;
          i++;
          continue;
        }
        if (leadIndent(i) <= parentIndent || /^[ \t]*#/.test(lines[i])) break;
        const raw = lines[i].trim();
        const t = stripComment(raw);
        if (/:(?:[ \t]|$)/.test(t)) fail("`: ` inside a plain value; quote it");
        out += blanks ? "\n".repeat(blanks) : " ";
        out += t;
        multi = true;
        blanks = 0;
        i++;
        if (t.length < raw.length) break;
      }
    }
    return multi ? out : typedPlain(out);
  }

  function closeQuoted(s, end) {
    const tail = s.slice(end);
    if (!/^[ \t]*(?:#.*)?$/.test(tail) || /^#/.test(tail))
      fail("unexpected text after a closing quote");
    i++;
  }

  function parseQuoted(rest, parentIndent) {
    const q = rest[0];
    let s = rest;
    let r = scanQuoted(s, 1, q);
    let out = r.out;
    while (r.end < 0) {
      if (!r.escapedBreak)
        out = out.slice(0, out.length - r.out.length + r.keep);
      let blanks = 0;
      i++;
      while (i < n && isBlank(i)) {
        blanks++;
        i++;
      }
      if (i >= n) fail("unterminated quoted string");
      if (leadIndent(i) <= parentIndent)
        fail("a quoted string continues at or left of its parent's indent");
      if (r.escapedBreak) out += "\n".repeat(blanks);
      else out += blanks ? "\n".repeat(blanks) : " ";
      s = lines[i].replace(/^[ \t]+/, "");
      r = scanQuoted(s, 0, q);
      out += r.out;
    }
    closeQuoted(s, r.end);
    return out;
  }

  function parseFlow(rest) {
    if (rest[0] === "{") {
      if (/^\{[ \t]*\}[ \t]*(?:#.*)?$/.test(rest)) {
        i++;
        return {};
      }
      fail("flow mappings are not supported");
    }
    const items = [];
    let j = 1;
    const skipSpace = () => {
      while (rest[j] === " " || rest[j] === "\t") j++;
    };
    for (;;) {
      skipSpace();
      if (j >= rest.length) fail("multi-line flow sequences are not supported");
      if (rest[j] === "]") break;
      const c = rest[j];
      if (c === '"' || c === "'") {
        const r = scanQuoted(rest, j + 1, c);
        if (r.end < 0) fail("multi-line flow sequences are not supported");
        items.push(r.out);
        j = r.end;
      } else {
        if ("[{&*!|>%@`#".includes(c))
          fail("nested or decorated flow items are not supported");
        let k = j;
        while (k < rest.length && rest[k] !== "," && rest[k] !== "]") k++;
        const item = rest.slice(j, k).trim();
        if (/[[\]{}]|:(?:[ \t]|$)| #/.test(item))
          fail("nested or decorated flow items are not supported");
        if (item === "") fail("empty flow sequence item");
        items.push(typedPlain(item));
        j = k;
      }
      skipSpace();
      if (rest[j] === ",") {
        j++;
        continue;
      }
      if (rest[j] === "]") break;
      fail("expected , or ] in a flow sequence");
    }
    closeQuoted(rest, j + 1);
    return items;
  }

  function parseBlockScalar(rest, parentIndent) {
    const m =
      /^([|>])(?:([1-9])([+-])?|([+-])([1-9])?)?(?:[ \t]+#.*)?[ \t]*$/.exec(
        rest,
      );
    if (!m) fail("bad block scalar header");
    const literal = m[1] === "|";
    const digit = m[2] || m[5];
    const chomp = m[3] || m[4] || "";
    let ind = digit ? Math.max(parentIndent, 0) + Number(digit) : -1;
    const body = [];
    i++;
    while (i < n) {
      if (isBlank(i)) {
        body.push("");
        i++;
        continue;
      }
      const line = lines[i];
      let sp = 0;
      while (line[sp] === " ") sp++;
      if (ind < 0) {
        if (sp <= parentIndent) break;
        ind = sp;
      }
      if (sp < ind) break;
      body.push(line.slice(ind));
      i++;
    }
    let end = body.length;
    while (end > 0 && body[end - 1] === "") end--;
    const trailing = body.length - end;
    const content = body.slice(0, end);
    if (content.length === 0) return chomp === "+" ? "\n".repeat(trailing) : "";
    const text = literal ? content.join("\n") : foldLines(content);
    if (chomp === "-") return text;
    if (chomp === "+") return `${text}\n${"\n".repeat(trailing)}`;
    return `${text}\n`;
  }

  // ---- document ----
  skipNoise();
  if (i < n && lines[i].startsWith("%")) fail("directives are not supported");
  if (i < n && /^---(?:[ \t]|$)/.test(lines[i])) {
    if (stripComment(lines[i].slice(3)).trim())
      fail("content on the --- line is not supported");
    i++;
    skipNoise();
  }
  if (i >= n || /^\.\.\.(?:[ \t]|$)/.test(lines[i])) return null;
  const value = parseBlock(leadIndent(i), -1);
  skipNoise();
  if (i < n && /^\.\.\.(?:[ \t]|$)/.test(lines[i])) {
    i++;
    skipNoise();
    if (i < n) fail("several documents are not supported");
  }
  if (i < n) {
    if (/^---(?:[ \t]|$)/.test(lines[i]))
      fail("several documents are not supported");
    fail("unexpected content (check the indentation)");
  }
  return value;
}

// ---------- tar.gz ----------

function tarString(buf, start, len) {
  const end = buf.indexOf(0, start);
  return buf
    .subarray(start, end >= 0 && end < start + len ? end : start + len)
    .toString("utf8");
}

function tarNumber(buf, start, len) {
  if (buf[start] & 0x80) {
    // GNU base-256 for large values.
    let v = buf[start] & 0x7f;
    for (let k = start + 1; k < start + len; k++) v = v * 256 + buf[k];
    return v;
  }
  const s = tarString(buf, start, len).trim();
  if (!/^[0-7]*$/.test(s)) throw new Error("tar: bad number field");
  return s ? parseInt(s, 8) : 0;
}

// "<len> key=value\n" records; len counts bytes, so slice the Buffer.
function paxRecords(data) {
  const out = {};
  let k = 0;
  while (k < data.length) {
    const sp = data.indexOf(0x20, k);
    const digits = sp > k ? data.subarray(k, sp).toString("ascii") : "";
    const len = /^[0-9]+$/.test(digits) ? Number(digits) : 0;
    if (
      len <= sp - k + 1 ||
      k + len > data.length ||
      data[k + len - 1] !== 0x0a
    )
      throw new Error("tar: bad pax record");
    const rec = data.subarray(sp + 1, k + len - 1);
    const eq = rec.indexOf(0x3d);
    if (eq > 0)
      out[rec.subarray(0, eq).toString("utf8")] = rec
        .subarray(eq + 1)
        .toString("utf8");
    k += len;
  }
  return out;
}

// Minimal ustar/pax/GNU reader over an in-memory archive. Returns regular
// files as { name, size, data() } plus the pax global comment, which GitHub
// sets to the commit SHA.
export function readTar(buf) {
  const files = [];
  let globalComment = null;
  let nextName = null;
  let offset = 0;
  let ended = false;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) {
      // End of archive: two zero blocks.
      const next = buf.subarray(offset + 512, offset + 1024);
      if (next.length !== 512 || !next.every((b) => b === 0))
        throw new Error("tar: incomplete end-of-archive marker");
      ended = true;
      break;
    }
    let sum = 0;
    for (let k = 0; k < 512; k++) sum += k >= 148 && k < 156 ? 32 : header[k];
    if (sum !== tarNumber(header, 148, 8))
      throw new Error("tar: header checksum mismatch");
    const size = tarNumber(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    let name = tarString(header, 0, 100);
    if (tarString(header, 257, 5) === "ustar") {
      const prefix = tarString(header, 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    const start = offset + 512;
    const next = start + Math.ceil(size / 512) * 512;
    if (next > buf.length) throw new Error("tar: truncated archive");
    const data = buf.subarray(start, start + size);
    offset = next;
    if (type === "g") {
      const rec = paxRecords(data);
      if (rec.comment) globalComment = rec.comment;
    } else if (type === "x") {
      const rec = paxRecords(data);
      if (rec.path) nextName = rec.path;
    } else if (type === "L") {
      nextName = tarString(data, 0, data.length);
    } else {
      if (nextName) name = nextName;
      nextName = null;
      if (type === "0" || type === "7")
        files.push({ name, size, data: () => data });
    }
  }
  if (!ended)
    throw new Error("tar: truncated archive (no end-of-archive marker)");
  return { files, globalComment };
}

// GitHub tarballs wrap everything in one top folder (<repo>-<ref>/).
const stripTop = (name) => {
  const k = name.indexOf("/");
  return k >= 0 ? name.slice(k + 1) : name;
};

// Parse a downloaded tarball into records ready for entries.json.
export function parseTarball(gz, src = {}) {
  const tar = zlib.gunzipSync(gz, { maxOutputLength: MAX_TAR_BYTES });
  const { files, globalComment } = readTar(tar);
  const include = (
    Array.isArray(src.include) && src.include.length
      ? src.include
      : ["**/*.yaml", "**/*.yml"]
  ).map(globToRegExp);
  const previewBase = src.previewBase
    ? String(src.previewBase).replace(/^\/+|\/+$/g, "") + "/"
    : null;
  const records = [];
  const previews = [];
  const skipped = [];
  const tops = new Set(files.map((f) => f.name.split("/")[0]));
  for (const file of files) {
    const rel = stripTop(file.name);
    if (previewBase && rel.startsWith(previewBase) && IMAGE_EXT.test(rel)) {
      previews.push(rel);
      continue;
    }
    if (!include.some((re) => re.test(rel))) continue;
    if (file.size > MAX_YAML_BYTES) {
      skipped.push({ path: rel, reason: "file too large" });
      continue;
    }
    try {
      const doc = parseYamlSubset(file.data().toString("utf8"));
      if (!isObject(doc)) {
        skipped.push({ path: rel, reason: "not a mapping" });
        continue;
      }
      records.push({ path: rel, doc });
    } catch (error) {
      skipped.push({ path: rel, reason: String(error.message || error) });
    }
  }
  if (records.length === 0)
    throw new Error("tar: no YAML entry matched the include globs");
  records.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  previews.sort();
  return {
    sha: /^[0-9a-f]{40}$/.test(globalComment || "") ? globalComment : null,
    topDir: tops.size === 1 ? [...tops][0] : null,
    records,
    previews,
    skipped,
  };
}

// ---------- mapping ----------

const VIDEO_EXT = /\.(?:mp4|webm|mov|m4v)$/i;
const IMAGE_EXT = /\.(?:jpe?g|png|webp|gif|avif)$/i;

// Extension tests look at the URL path only, never at the query string.
const urlPath = (u) => {
  try {
    return new URL(u).pathname;
  } catch {
    return "";
  }
};
const isVideoUrl = (u) => VIDEO_EXT.test(urlPath(u));
const isImageUrl = (u) => IMAGE_EXT.test(urlPath(u));

function httpsUrl(v) {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

function pickLocale(v, locale) {
  if (typeof v === "string") return v.trim();
  if (!isObject(v)) return "";
  for (const k of [locale, "en", "zh"]) {
    if (typeof v[k] === "string" && v[k].trim()) return v[k].trim();
  }
  const first = Object.values(v).find((x) => typeof x === "string" && x.trim());
  return first ? first.trim() : "";
}

function str(v) {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  return null;
}

// The language of the prompt text itself (titles may be translated, the
// prompt is what the generator receives). Japanese and Korean give null.
export function detectLang(text) {
  if (!text) return null;
  // Chinese text has no kana, so a few kana mean Japanese.
  if ((text.match(/[\u3040-\u30ff]/g) || []).length >= 2) return null;
  const han = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const hangul = (text.match(/[\uac00-\ud7af]/g) || []).length;
  const words = (text.match(/[A-Za-z]/g) || []).length / 5;
  const top = Math.max(han, hangul, words);
  if (top === 0 || top === hangul) return null;
  return top === han ? "zh" : "en";
}

// The output sample: a URL string, a list, or a map with url/poster keys.
// Only direct video files become videos; image files (gif, posters) become
// sourceMedia; post links (x.com, reddit) are dropped.
function collectVideo(v, videos, media) {
  if (Array.isArray(v)) {
    for (const x of v) collectVideo(x, videos, media);
    return;
  }
  if (isObject(v)) {
    for (const k of ["url", "src", "mp4", "webm", "file"])
      collectVideo(v[k], videos, media);
    for (const k of ["poster", "thumbnail", "cover", "image"]) {
      const u = httpsUrl(v[k]);
      if (u && isImageUrl(u)) media.push(u);
    }
    return;
  }
  const u = httpsUrl(v);
  if (!u) return;
  if (isVideoUrl(u)) videos.push(u);
  else if (isImageUrl(u)) media.push(u);
}

// "15", 15, "15s", "15 sec", "15 seconds"; anything else ("10ms") is null.
export function parseSeconds(v) {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  const m = /^\s*(\d{1,4}(?:\.\d+)?)\s*(?:s|secs?|seconds?|秒)?\s*$/i.exec(v);
  const x = m ? Number(m[1]) : NaN;
  return x > 0 ? x : null;
}

// Total length, only from explicit fields or phrasing that describes the
// whole clip: a title ending in "15 s"; a prompt that opens with a bare
// "15s," / "15 seconds."; "15-second video|clip|shot|ad...", "a 10s video";
// "duration: 15s"; "时长 15 秒". A number+unit about a pause, hold, beat,
// delay, gap, wait or transition, or one inside a time-coded shot list
// ("0-3s: ...", "00:04", "[Shot 2]"), is not the clip length.
const CLIP_NOUN =
  "(?:video|clip|film|movie|sequence|shot|commercial|ad|advert|spot|trailer|teaser|reel|vlog|animation|montage|short)";
const NOT_CLIP = "(?:pause|hold|beat|delay|gap|wait|transition)";
const UNIT = "(?:s|sec|secs|seconds?)";
const DURATION_PATTERNS = [
  // Bare opener: "15s, handheld ...", "10 seconds. ..."
  new RegExp(
    `^[\\s"'([]*(\\d{1,3}(?:\\.\\d+)?)[- ]?${UNIT}(?=\\s*(?:[,.;|]|$))`,
    "i",
  ),
  // "a 15-second cinematic video", "a 10s video", "15 second shot"
  new RegExp(
    `(?<![\\d.\\-–~/])(\\d{1,3}(?:\\.\\d+)?)[- ]?${UNIT},?\\s+(?:(?!${NOT_CLIP}\\b)[\\w-]+,?\\s+){0,3}?${CLIP_NOUN}s?\\b`,
    "i",
  ),
  /\b(?:duration|length|runtime)\s*(?:[:=]|is|of)?\s*(\d{1,3}(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)\b/i,
  /(?:时长|长度)\s*[:：]?\s*(\d{1,3})\s*秒/,
];
// Markers of a time-coded shot list: "0-3s", "3–7 sec", "00:04", "[Shot 1]",
// "Shot 2:".
const TIMECODE =
  /\d(?:\.\d+)?\s*(?:s|sec)?\s*[-–~]\s*\d{1,3}(?:\.\d+)?\s*(?:s|sec|seconds?)\b|\b\d{1,2}:\d{2}\b|\[\s*shot\b|\bshot\s*\d+\s*[:\]]/i;

export function inferDuration(doc, titles, content) {
  for (const k of ["durationSec", "duration_sec", "duration"]) {
    const x = parseSeconds(doc[k]);
    if (x) return x;
  }
  for (const t of titles) {
    const m =
      /(?:^|[\s,，(（])(\d{1,3}(?:\.\d+)?)\s?(?:s|sec|secs|seconds?|秒)\s*[)）]?$/i.exec(
        t,
      );
    if (m) return Number(m[1]);
  }
  const head = content.slice(0, 300);
  for (const re of DURATION_PATTERNS) {
    const m = re.exec(head);
    if (!m || !(Number(m[1]) > 0)) continue;
    const isPhrase = re === DURATION_PATTERNS[2] || re === DURATION_PATTERNS[3];
    if (!isPhrase && TIMECODE.test(head.slice(0, m.index + m[0].length)))
      continue;
    return Number(m[1]);
  }
  return null;
}

// Aspect ratio, only from explicit fields or explicit aspect phrasing
// ("aspect ratio 9:16", "16:9 aspect", "vertical 9:16", "--ar 16:9").
const RATIO = "(\\d{1,2}(?:\\.\\d{1,2})?:\\d{1,2})";
const RATIO_PATTERNS = [
  new RegExp(
    `\\baspect(?:[ -]ratio)?\\s*(?:[:=]|is|of)?\\s*${RATIO}(?![\\d:])`,
    "i",
  ),
  new RegExp(`(?<![\\d.:])${RATIO}\\s*(?:aspect|ratio|format|frame)\\b`, "i"),
  new RegExp(
    `\\b(?:vertical|horizontal|portrait|landscape|widescreen|square)\\s*\\(?\\s*${RATIO}(?![\\d:])`,
    "i",
  ),
  new RegExp(`--ar\\s+${RATIO}(?![\\d:])`, "i"),
  new RegExp(`(?:画幅|比例|宽高比)\\s*[:：]?\\s*${RATIO}(?![\\d:])`),
];

export function inferRatio(doc, content) {
  for (const k of ["ratio", "aspect_ratio", "aspectRatio"]) {
    const v = typeof doc[k] === "string" ? doc[k].trim() : "";
    if (/^\d{1,2}(?:\.\d{1,2})?:\d{1,2}$/.test(v)) return v;
  }
  for (const re of RATIO_PATTERNS) {
    const m = re.exec(content);
    if (m) return m[1];
  }
  return null;
}

function rawBase(src) {
  return `https://raw.githubusercontent.com/${src.repo}/${src.branch || "main"}/`;
}

// One parsed YAML document -> a partial entry (see contract), or null.
export function mapDoc(
  doc,
  { path: rel = "", src = {}, previews = new Set() } = {},
) {
  if (!isObject(doc)) return null;
  const base = path.posix.basename(rel).replace(/\.ya?ml$/i, "");
  const nativeId = str(doc.id) || base;
  if (!nativeId) return null;
  const locale = src.locale || "en";
  const kinds =
    Array.isArray(src.kinds) && src.kinds.length
      ? src.kinds
      : ["image", "video", "code-video"];
  const kind = rel
    .split("/")
    .slice(0, -1)
    .find((seg) => kinds.includes(seg));
  const content =
    typeof doc.prompt === "string" ? doc.prompt.replace(/\s+$/, "") : "";
  const category = str(doc.category);
  const tags = [];
  for (const t of [...(Array.isArray(doc.tags) ? doc.tags : []), category]) {
    const s = str(t);
    if (s && !tags.includes(s)) tags.push(s);
  }
  const source = isObject(doc.source) ? doc.source : {};
  const videos = [];
  const media = [];
  collectVideo(doc.video ?? doc.videos, videos, media);
  const sourceMedia = [];
  if (src.repo && src.previewBase) {
    const dir = String(src.previewBase).replace(/^\/+|\/+$/g, "") + "/";
    const own = [...previews]
      .filter((p) => p.startsWith(dir) && path.posix.parse(p).name === nativeId)
      .sort((a, b) => Number(/\.gif$/i.test(a)) - Number(/\.gif$/i.test(b)));
    for (const p of own)
      sourceMedia.push(
        rawBase(src) + p.split("/").map(encodeURIComponent).join("/"),
      );
  }
  for (const u of media) if (!sourceMedia.includes(u)) sourceMedia.push(u);
  const mode = str(doc.mode);
  const titles = isObject(doc.title)
    ? Object.values(doc.title).filter((t) => typeof t === "string")
    : [String(doc.title || "")];
  const entry = {
    nativeId,
    title: pickLocale(doc.title, locale),
    description: pickLocale(doc.notes ?? doc.description, locale),
    content,
    lang: detectLang(content),
    sourceMedia,
    videos: [...new Set(videos)],
    model: str(doc.model),
    tags,
    category,
    author: str(source.credit) || str(source.name) || str(doc.author),
    link: httpsUrl(source.url) || null,
    needReferenceImages:
      (Array.isArray(doc.inputs) && doc.inputs.length > 0) ||
      /edit|image-to|reference|keyframes|extend/i.test(mode || ""),
    mode,
  };
  if (kind) entry.kind = kind;
  if (kind !== "image") {
    entry.durationSec = inferDuration(doc, titles, content);
    entry.ratio = inferRatio(doc, content);
  }
  return entry;
}

// ---------- adapter interface ----------

const validRepo = (r) => /^[\w-][\w.-]*\/[\w-][\w.-]*$/.test(String(r || ""));
const validBranch = (b) => /^[\w./-]+$/.test(b) && !b.includes("..");

export async function sync(src, ctx) {
  const results = [];
  const repo = src.repo;
  const branch = src.branch || "main";
  if (!validRepo(repo) || !validBranch(branch)) {
    results.push({
      url: null,
      status: "invalid-source",
      hint: "yaml-tree needs repo as owner/name and a plain branch name",
    });
    return { results };
  }
  fs.mkdirSync(ctx.dir, { recursive: true });
  const entriesFile = path.join(ctx.dir, ENTRIES_FILE);
  const refFile = path.join(ctx.dir, REF_FILE);
  const tarFile = path.join(ctx.dir, TARBALL_FILE);

  const current = readJson(entriesFile, null);
  const cached =
    isObject(current) &&
    current.format === FORMAT &&
    Array.isArray(current.records);
  const summary = (status, data) => ({
    results,
    status,
    sha: data ? data.sha : null,
    entries: data ? data.records.length : 0,
    skipped: data ? data.skipped : [],
  });
  const keepOld = () =>
    summary(cached ? "stale" : "unavailable", cached ? current : null);

  const refUrl = `https://api.github.com/repos/${repo}/git/ref/heads/${branch}`;
  try {
    results.push(await ctx.fetchCached(refUrl, refFile));
  } catch (error) {
    results.push({
      url: refUrl,
      file: refFile,
      status: "unavailable-error",
      error: String(error.message || error),
    });
    return keepOld();
  }
  const ref = readJson(refFile, null);
  const headSha =
    isObject(ref) &&
    isObject(ref.object) &&
    /^[0-9a-f]{40}$/.test(String(ref.object.sha))
      ? ref.object.sha
      : null;
  if (cached && (!headSha || current.sha === headSha))
    return summary("unchanged", current);

  // No stale tarball, so fetchCached really downloads instead of answering
  // "fresh" or sending If-None-Match for a file we are about to discard.
  fs.rmSync(tarFile, { force: true });
  // Download the exact commit the ref named, so an older archive can never
  // be stamped with the new SHA; without a SHA fall back to the branch.
  const url = headSha
    ? `https://codeload.github.com/${repo}/tar.gz/${headSha}`
    : `https://codeload.github.com/${repo}/tar.gz/refs/heads/${branch}`;
  try {
    const tarReport = await ctx.fetchCached(url, tarFile, { force: true });
    results.push(tarReport);
    if (tarReport.status !== "updated" || !fs.existsSync(tarFile))
      return keepOld();
    const parsed = parseTarball(fs.readFileSync(tarFile), src);
    const got =
      parsed.sha ||
      (parsed.topDir && /-([0-9a-f]{40})$/.exec(parsed.topDir)?.[1]) ||
      null;
    if (headSha && got !== headSha) {
      results.push({
        url,
        file: tarFile,
        status: "sha-mismatch",
        expected: headSha,
        got,
      });
      return keepOld();
    }
    const data = {
      format: FORMAT,
      repo,
      branch,
      sha: headSha || parsed.sha,
      syncedAt: new Date(ctx.now ?? Date.now()).toISOString(),
      previews: parsed.previews,
      records: parsed.records,
      skipped: parsed.skipped,
    };
    writeJsonAtomic(entriesFile, data);
    return summary("updated", data);
  } catch (error) {
    results.push({
      url,
      file: tarFile,
      status: "parse-error",
      error: String(error.message || error),
    });
    return keepOld();
  } finally {
    fs.rmSync(tarFile, { force: true });
  }
}

export function load(src, ctx) {
  const data = readJson(path.join(ctx.dir, ENTRIES_FILE), null);
  if (!isObject(data) || !Array.isArray(data.records)) return [];
  const previews = new Set(Array.isArray(data.previews) ? data.previews : []);
  const out = [];
  for (const rec of data.records) {
    try {
      const entry = mapDoc(rec && rec.doc, {
        path: String((rec && rec.path) || ""),
        src,
        previews,
      });
      if (entry) out.push(entry);
    } catch {
      // Bad record: skip it, never fail the whole source.
    }
  }
  return out;
}
