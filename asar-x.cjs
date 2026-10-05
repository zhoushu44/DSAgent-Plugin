const fs = require("fs");
const path = require("path");
const asarPath = process.argv[2];
const outDir = process.argv[3];
const buf = fs.readFileSync(asarPath);
const payloadSize = buf.readUInt32LE(4);
const headerStringLength = buf.readUInt32LE(12);
const header = JSON.parse(buf.toString("utf8", 16, 16 + headerStringLength));
function align4(n){ return (n+3) & ~3; }
const contentBase = 8 + align4(payloadSize);
let count = 0;
function walk(node, base) {
  for (const name of Object.keys(node.files || {})) {
    const child = node.files[name];
    const dest = path.join(base, name);
    if (child.files) { fs.mkdirSync(dest,{recursive:true}); walk(child, dest); }
    else if (child.unpacked) {}
    else {
      const off = contentBase + Number(child.offset||0);
      const size = Number(child.size||0);
      fs.mkdirSync(path.dirname(dest),{recursive:true});
      fs.writeFileSync(dest, buf.subarray(off, off+size));
      count++;
    }
  }
}
fs.mkdirSync(outDir,{recursive:true});
walk(header, outDir);
console.log("extracted:", count);