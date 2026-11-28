// pdd-crawl CLI 包装：node pdd-crawl-cli.mjs --mode search --keyword X --goods-id Y --limit N
// 输出 __DSAGENT_RESULT__{...} 供 MCP server 解析。账号取本机 ~/.dsh/dsagent-accounts.json 里已登录的 pdd 账号。
import { pathToFileURL } from 'node:url'; import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os';
import { createRequire } from 'node:module';
const require2 = createRequire(import.meta.url);
const __dirname = path.dirname(require2.resolve('./pdd-crawl-cli.mjs')).replace(/\\/g, '/');
const emit = r => { console.log('__DSAGENT_RESULT__' + JSON.stringify(r)); process.exit(0); };
const argOf = k => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null; };

const STORE_PATH = path.join(os.homedir(), '.dsh', 'dsagent-accounts.json');
const { CredentialStore } = await import(pathToFileURL(path.join(__dirname, 'services', 'credential-store.js')).href);
const store = new CredentialStore(STORE_PATH);
const { pddCrawl } = await import(pathToFileURL(path.join(__dirname, 'pdd-crawl.js')).href);

const mode = argOf('mode') || (argOf('goods-id') ? 'goods' : (argOf('keyword') ? 'search' : 'feed'));
const opts = { mode, keyword: argOf('keyword') || undefined, goodsId: argOf('goods-id') || undefined, limit: Number(argOf('limit') || 20) };
// 账号：取凭证库里第一个 pdd 平台账号
let shopKey = argOf('account');
if (!shopKey) { const accts = store.listAccounts().filter(a => (a.platform || '').startsWith('pdd')); if (!accts.length) emit({ ok: false, failureKind: 'not_bound', text: '本机凭证库没有拼多多账号：先跑 login-pdd.ps1 扫码登录商家后台' }); shopKey = accts[0].shopKey || accts[0].key; }
try { emit(await pddCrawl(store, { ...opts, shopKey })); }
catch (e) { emit({ ok: false, failureKind: 'api_error', text: String(e.message || e).slice(0, 500) }); }
