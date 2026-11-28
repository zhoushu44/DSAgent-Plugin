// 批量真实提交（放入仓库）+ 截图验证。用法：node submit-batch.cjs <商品JSON> [商品JSON ...]
// 每个商品：完整填表 → 主图 → 运费 → 放入仓库 → 提交前核对 → 只点一次提交 → 截成功页 → 开买家页核对并截图 → 下一个。
const path = require('path');
const fs = require('fs');
const { TaobaoPublishPage, getBrowser, sleep, setSpeed } = require('./lib.cjs');
const IMG = path.join(__dirname, 'test-images', 'main-test.jpg');
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const WAREHOUSE = '放入仓库';
const shot = async (page, file) => { let t; await Promise.race([page.screenshot({ path: file }).catch(e => console.log('  截图失败 ' + e.message.slice(0, 50))), new Promise(r => { t = setTimeout(r, 40000); })]).finally(() => clearTimeout(t)); };
const results = [];
// 图片空间按「文件名→key」缓存复用：★只对同名文件生效（真实业务每个产品图不同，绝不会误用上一张图的 key）。
// 批量内同名图（如测试共用图）只上传一次；核对发现 imgs=0 时清缓存回退上传。
const KEY_FILE = path.join(__dirname, 'imgspace-key.json');
let keyCache = fs.existsSync(KEY_FILE) ? (() => { try { return JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')); } catch (e) { return {}; } })() : {};
const keyFor = file => keyCache[path.basename(file)] || null;
const files = process.argv.slice(2).filter(a => !a.startsWith('--') && a !== (process.argv.includes('--image-key') ? process.argv[process.argv.indexOf('--image-key') + 1] : null));
(async () => {
  const browser = await getBrowser();
  for (const f of files) {
    const P = JSON.parse(fs.readFileSync(f, 'utf8')); const tag = P.itemNo || path.basename(f);
    const page = await browser.newPage(); const t = new TaobaoPublishPage(null); t.page = page;
    let rec = { itemNo: tag, catId: P.catId, title: P.title, tStart: new Date().toISOString() }; results.push(rec);
    console.log(`\n################ ${tag}  ${P.title}`);
    try {
      page.on('dialog', d => { console.log(`  [浏览器弹框] ${d.type()}: ${String(d.message()).slice(0, 80)}`); d.dismiss().catch(() => {}); });
      await page.setViewport({ width: 1440, height: 900 });
      await t.open(P.catId);
      for (const [k, v] of [['title', P.title], ['price', P.price], ['quantity', P.stock], ['outerId', P.itemNo]]) { if (v != null) await t.typeInto(`#struct-${k} input`, null, String(v), 'Tab'); }
      await sleep(1200);
      const attrs = Object.assign({}, P.attributes || {}); if (P.materials) { const mf = (await t.catPropSchema()).find(x => x.uiType === 'material'); if (mf) attrs[mf.label] = P.materials; }
      // 全属性模式：给每个能填的属性都配值（枚举取第一个候选；文本/度量取通用值）。品牌与材质仍走各自通道。
      if (P.fillAllAttrs) {
        const schema = await t.catPropSchema(); let n = 0;
        for (const f of schema) {
          if (f.label === '品牌' || f.uiType === 'material' || attrs[f.label] != null) continue;
          if (f.options && f.options.length) { attrs[f.label] = f.multi ? [f.options[0].text] : f.options[0].text; n++; }
          else if (f.uiType === 'input') { attrs[f.label] = '2026'; n++; }
          else if (f.uiType === 'taoSirProp') { attrs[f.label] = '1' + ((f.options || [])[0] ? '|' + f.options[0].text : ''); n++; }
        }
        console.log(`  全属性模式: 为 ${n} 个属性配值（共 ${schema.length} 个，品牌/材质除外）`);
      }
      const ar = await t.fillAttributes(attrs); rec.attrsMissed = ar.missed;
      console.log('  类目属性: 已填 ' + ar.filled.length + ' 项，未填: ' + (ar.missed.join('；') || '无'));
      await t.fillSpecs(P); await sleep(2500);
      const rows = await t.readSkuRows(); const mapped = await t.mapSkuRows(P, rows);
      const back = (await t.fillSkuRows(mapped.map(m => m.sku || {}))).map((r, i) => [rows[i] && rows[i].join('/'), ...r]);
      rec.sku = back; console.log('  SKU 回读: ' + JSON.stringify(back));
      rec.skuParams = await t.fillSkuParams(P, rows); if (P.sizeTable) rec.sizeTable = await t.fillSizeTable(P.sizeTable); rec.discount = await t.enableMultiDiscount();
      rec.tSubmitReady = new Date().toISOString();
      const imgs = Array.isArray(P.images) && P.images.length ? P.images : [IMG];
      const firstKey = keyFor(imgs[0]);
      const rep = await t.prepareSubmit({ images: imgs, imageKey: firstKey, startTime: P.startTime || undefined, scheduledAt: P.scheduledAt || undefined });
      if (rep.imageKey) { rec.imageKey = rep.imageKey; keyCache[path.basename(imgs[0])] = rep.imageKey; try { fs.writeFileSync(KEY_FILE, JSON.stringify(keyCache)); } catch (e) {} }
      const checks = await page.evaluate(() => ({ start: Array.from(document.querySelectorAll('#struct-startTime .radio-item')).map(w => ({ t: ((w.querySelector('.item-label') || w)).innerText.replace(/\s+/g, '').trim(), c: !!(w.querySelector('input[type=radio]') || {}).checked })).filter(x => x.t), labels: Array.from(document.querySelectorAll('#struct-startTime label, #struct-startTime .next-radio-wrapper')).map(e => e.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean),
        title: (document.querySelector('#struct-title input') || {}).value, imgs: Array.from(document.querySelectorAll('#struct-mainImagesGroup img')).filter(i => /alicdn/.test(i.src)).length,
        freight: document.querySelector('#struct-tbExtractWay').innerText.includes('系统模板-商家默认模板'), wuliup: Array.from(document.querySelectorAll('#struct-tbExtractWay input[type=checkbox]')).map(c => c.checked) }));
      const wi = checks.labels.indexOf(WAREHOUSE);
      // 按选中项的文字判断（内外双层 label 曾导致下标错位）
      const wh = checks.start.find(x => x.t.replace(/\s+/g, '') === WAREHOUSE);
      const ds = checks.start.find(x => x.t.replace(/\s+/g, '') === '定时上架');
      const startOk = !!(wh && wh.c) || (P.startTime === '定时上架' && !!(ds && ds.c) && rep.scheduled && rep.scheduled.ok === true);
      const safe = startOk && checks.imgs >= 1 && checks.freight && checks.wuliup[0] === true && (checks.title || '').includes('测试商品');
      if (!safe) { rec.status = '核对不通过未提交'; console.log('  ✗ 提交前核对不通过，未提交: ' + JSON.stringify(checks)); if (checks.imgs < 1) { delete keyCache[path.basename(Array.isArray(P.images) && P.images.length ? P.images[0] : IMG)]; try { fs.writeFileSync(KEY_FILE, JSON.stringify(keyCache)); } catch (e) {} console.log('  图片缓存已清（图可能被清理），下次重新上传'); } continue; }
      const before = page.url();
      // 提交按钮用 JS 直接触发（坐标点击会被「测量→点击」间隙的重渲染甩开，提速下实测静默失败）；jsClick 失败回退坐标点击
      if (!await t.jsClickText('body', '提交宝贝信息', '提交宝贝信息')) { if (!await t.clickText('body', '提交宝贝信息', '提交宝贝信息')) { rec.status = '没找到提交按钮'; continue; } }
      let st = null;
      for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 1500)); // 轮询总等待不随 SPEED 缩水：成功跳转有时要 30s+
        st = await page.evaluate(() => { const vis = e => e.offsetParent !== null || e.getClientRects().length > 0; const txt = e => (e.innerText || '').replace(/\s+/g, ' ').trim();
          return { url: location.href.slice(0, 220), hint: (document.body.innerText.match(/.{0,20}(商品提交成功|发布成功|提交失败|发布失败).{0,30}/g) || []).slice(0, 2),
            errs: Array.from(document.querySelectorAll('.next-form-item-help.error, .error-msg, [class*="error"]')).filter(e => vis(e) && txt(e) && !/^\d+\/\d+$/.test(txt(e))).map(txt).filter((v, i, a) => a.indexOf(v) === i).slice(0, 15),
            overlays: Array.from(document.querySelectorAll('.next-overlay-wrapper.opened .next-overlay-inner, [class*="dialog"]')).filter(vis).map(txt).filter(Boolean).slice(0, 3).map(x => x.slice(0, 300)) }; }).catch(e => ({ err: e.message }));
        if (st.url !== before || (st.hint && st.hint.length)) break;
        // 只把真正的校验错误当报错提前退出（「填写助手/上架时间」这类提醒也会带 error 类名，曾导致成功跳转被漏检）
        const realErrs = (st.errs || []).filter(x => /不能为空|必填|请填写|请输入|超过|填写错误/.test(x));
        if (realErrs.length && i > 5) break; }
      const m = /primaryId=(\d+)/.exec(st.url || ''); rec.status = m ? '提交成功' : '未成功'; rec.itemId = m ? m[1] : null; rec.pageHint = st.hint; rec.errors = st.errs; rec.page = st.url;
      console.log(`  结果: ${rec.status} ${rec.itemId || ''} ${JSON.stringify(st.hint || '')} ${st.errs && st.errs.length ? '页面报错: ' + JSON.stringify(st.errs) : ''}`);
      await sleep(2000); await shot(page, path.join(SHOTS, `${tag}-1-提交结果.png`));
      if (m) { await sleep(3000);
        const b = await browser.newPage(); try { await b.setViewport({ width: 1440, height: 900 }); await b.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36');
          await b.goto(`https://item.taobao.com/item.htm?id=${m[1]}`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(5000);
          rec.buyer = await b.evaluate(() => { const x = document.body.innerText.replace(/\s+/g, ' '); return { title: document.title.slice(0, 70), offShelf: /已经下架/.test(x), price: (x.match(/￥\s*[\d.]+/) || [''])[0], head: x.slice(x.indexOf('图文详情'), x.indexOf('图文详情') + 90) }; });
          console.log('  买家页: ' + JSON.stringify(rec.buyer));
          await b.evaluate(() => { const el = document.getElementById('J_DetailMeta') || document.querySelector('[class*="ItemHeader"]') || document.body; el.scrollIntoView(); }); await sleep(800);
          await shot(b, path.join(SHOTS, `${tag}-2-买家页.png`));
        } catch (e) { rec.buyerErr = e.message.slice(0, 100); } finally { await b.close().catch(() => {}); } }
    } catch (e) { rec.status = '脚本异常'; rec.error = e.message.slice(0, 200); console.log('  脚本异常: ' + rec.error); }
    finally { fs.writeFileSync(path.join(__dirname, 'submit-batch-result.json'), JSON.stringify(results, null, 2)); await page.close().catch(() => {}); }
    await new Promise(r => setTimeout(r, 15000)); // 防风控批量间隔，不随 SPEED 缩水
  }
  browser.disconnect();
  console.log('\n==== 汇总 ===='); for (const r of results) console.log(`${r.itemNo.padEnd(12)} ${String(r.status).padEnd(10)} ${r.itemId || '-'}  SKU ${r.sku ? r.sku.length : 0} 行  买家页${r.buyer ? (r.buyer.offShelf ? '已下架' : '可购买!') : '-'}`);
})().catch(e => { console.error(e); process.exit(1); });

