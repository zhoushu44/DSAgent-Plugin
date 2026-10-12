const fs = require("fs");
const s = fs.readFileSync("analysis/accio/out/main/index.js", "utf8");
// Find refresh interceptor Dc: how 401 triggers refresh + retry
const i = s.indexOf("Dc=i(()=>{os(),Ui(),nc=ss(\"auth:refresh\")");
if (i > 0) {
  // dump following code that uses Dc / refresh interceptor
  const seg = s.slice(i, i + 100);
  console.log(seg);
}
// search for the interceptor that wraps requests: look for "sc.has(" usage
const j = s.indexOf("sc.has(");
if (j > 0) {
  console.log("=== interceptor using auth endpoints set ===");
  console.log(s.slice(j - 1500, j + 1500).replace(/\n/g, " "));
}
