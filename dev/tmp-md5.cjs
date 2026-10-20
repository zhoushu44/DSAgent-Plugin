const crypto = require('crypto');
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('e:\\360MoveData\\Users\\Administrator\\Desktop\\DSAgent-Plugin\\dev\\tmp-pdd-cookies.json', 'utf8'));
const jar = {};
for (const pair of data.cookieStr.split('; ')) {
  const i = pair.indexOf('=');
  if (i > 0) jar[pair.slice(0, i)] = pair.slice(i + 1);
}
const passId = jar['PASS_ID'] || '';
const md5 = crypto.createHash('md5').update(passId).digest('hex').slice(0, 32);
console.log('PASS_ID  = ' + passId);
console.log('new md5  = ' + md5);
console.log('new shopKey = pdd_mms_' + md5);
console.log('old shopKey = pdd_mms_3b422bc6631bd52b245db96bde9e1002');
console.log('MATCH = ' + (md5 === '3b422bc6631bd52b245db96bde9e1002'));
