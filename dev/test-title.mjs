const cases = [
  { t: '女童珊瑚绒睡衣可外穿秋冬新款儿童法兰绒套装女孩加绒加厚家居服 1号', expect: 'BLOCK' },
  { t: '女童珊瑚绒睡衣秋冬加厚家居服粉色1号', expect: 'PASS' },
  { t: '女童珊瑚绒睡衣秋冬加厚家居服舒适100号', expect: 'PASS' },
  { t: '纯棉毛巾家用洗脸巾加厚吸水速干柔软成人情侣款', expect: 'PASS' },
]

for (const c of cases) {
  const hanzi = (c.t.match(/[\u4e00-\u9fa5]/g) || []).length
  const pdd = hanzi * 2 + (c.t.length - hanzi)
  const blocked = hanzi > 30 || pdd > 60
  const result = blocked ? 'BLOCK' : 'PASS'
  const mark = result === c.expect ? '✅' : '❌'
  console.log(`${mark} 汉字${hanzi} / pdd算法${pdd} → ${result}（期望 ${c.expect}）| ${c.t.slice(0, 28)}`)
}
