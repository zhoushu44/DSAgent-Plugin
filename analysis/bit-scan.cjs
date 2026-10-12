const fs = require("fs");
const s = fs.readFileSync("analysis/bitbrowser/electron-main.js", "utf8");
// dump Qg (sync cookies to oss) and My (browser closed handler - upload state)
for (const fn of ["async function Qg(", "async function My(", "function Qg("]) {
  const i = s.indexOf(fn);
  if (i > 0) {
    console.log("=== " + fn + " ===");
    console.log(s.slice(i, i + 2600).replace(/\n/g, " "));
    console.log();
  }
}
