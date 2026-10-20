import fs from 'node:fs';
for (const f of ['PUBLISH-MATRIX.md','PUBLISH-SPEC.md','CONTENT-PUBLISH-MATRIX.md']) {
  console.log('=====' + f);
  fs.readFileSync(f,'utf8').split(/\r?\n/).forEach((l,i)=>{ if(/^#{1,4} /.test(l)) console.log((i+1)+': '+l); });
}
