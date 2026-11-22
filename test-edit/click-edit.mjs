import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
const P='E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const {default:puppeteer}=await import(pathToFileURL(P+'/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js').href)
const {CredentialStore}=await import(pathToFileURL(P+'/lib/services/credential-store.js').href)
const {launchStealth}=await import(pathToFileURL(P+'/skills/_shared/pdd-launch.mjs').href)
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const log=(...a)=>console.log('[C]',...a)
const store=new CredentialStore(path.join(os.homedir(),'.dsh','dsagent-accounts.json'))
const all=store.listAccounts().filter(x=>x.platform==='pdd_mms')
const ckOf=x=>{const v=x.cookies;if(!v)return 0;if(typeof v==='object')return Object.keys(v).length;if(typeof v==='string')return v.split(';').filter(Boolean).length;return 0}
const acc=all.filter(x=>ckOf(x)>0&&x.status!=='reauth_required')[0]
const {browser,page}=await launchStealth(acc.shop_key,puppeteer)
const p=page
await p.goto('https://mms.pinduoduo.com/goods/goods_list',{waitUntil:'domcontentloaded'}).catch(()=>{})
await sleep(9000)
log('页面:',p.url().slice(0,70))

// 找到目标商品行，点「编辑」
const targetId=process.argv[2]||'1027998749178'
const allIds=await p.evaluate(()=>{
  const out=[]
  for(const tr of document.querySelectorAll('tr')){
    const t=(tr.innerText||'').replace(/\s+/g,' ')
    const m=t.match(/ID:\s*(\d+)/)
    if(m) out.push({id:m[1],title:t.slice(0,50)})
  }
  return out
})
log('页面上共',allIds.length,'个商品:')
for(const x of allIds.slice(0,15)) log('  ',x.id,'|',x.title)
log('找商品',targetId,'的编辑按钮…')
const clicked=await p.evaluate((gid)=>{
  const t=(e)=>(e.innerText||'').replace(/\s+/g,' ').trim()
  // 找含该 ID 的行
  for(const tr of document.querySelectorAll('tr')){
    const txt=t(tr)
    if(!txt.includes(gid)) continue
    // 行内找「编辑」
    const els=[...tr.querySelectorAll('a,button,span,div')].filter(e=>{
      const x=t(e)
      return /^编辑$/.test(x) && e.getBoundingClientRect().width>10 && e.getBoundingClientRect().height>8
    })
    if(els.length){ els[0].scrollIntoView({block:'center'}); els[0].click(); return {ok:true,via:'row-edit',text:t(els[0])} }
    return {ok:false,reason:'行内无编辑',rowText:txt.slice(0,120)}
  }
  // 兜底：全页找 data-tracking-viewid 含 edit
  for(const e of document.querySelectorAll('[data-tracking-viewid*="edit"],[data-tracking-viewid*="Edit"]')){
    const tp=e.getAttribute('data-tracking-params')||''
    if(tp.includes(gid)){ e.scrollIntoView({block:'center'}); e.click(); return {ok:true,via:'tracking-edit',tp} }
  }
  return {ok:false,reason:'未找到该商品行'}
},targetId)
log('点击结果:',JSON.stringify(clicked))

// 等新标签
await sleep(6000)
const pages=await browser.pages()
log('\n当前所有标签:')
for(const x of pages) log('  ',x.url().slice(0,100))

// 找编辑页
const editPage=pages.find(x=>/goods_add\/index/.test(x.url())||/type=edit/.test(x.url()))
if(editPage){
  log('\n★ 编辑页已打开:',editPage.url())
  // 提取 URL 里的 id
  const m=editPage.url().match(/(?:goods_commit_id|commit_id|id)=(\d+)/g)
  log('URL 参数:',m)
  await editPage.bringToFront()
  const detail=await editPage.evaluate(()=>({url:location.href.slice(0,200),title:!!document.querySelector('input[placeholder*="商品标题组成"]')})).catch(()=>({}))
  log('页面信息:',JSON.stringify(detail))
} else {
  log('\n❌ 没有编辑页')
}
process.exit(0)
