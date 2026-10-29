// Support the documented directory test command on Node 22.
const fs = require("node:fs");
const path = require("node:path");
require("./studio.test.mjs");
require("./sources.test.mjs");
if (fs.existsSync(path.join(__dirname, "yaml-tree.test.mjs"))) {
  require("./yaml-tree.test.mjs");
}
if (fs.existsSync(path.join(__dirname, "gallery.test.mjs"))) {
  require("./gallery.test.mjs");
}
if (fs.existsSync(path.join(__dirname, "markdown.test.mjs"))) {
  require("./markdown.test.mjs");
}
if (fs.existsSync(path.join(__dirname, "detect.test.mjs"))) {
  require("./detect.test.mjs");
}
