import{s as j}from"./rolldown-runtime-BSJ3dJRS.js";import{a as D,i as F}from"./vendor-react-BflrOYNF.js";import{i as O,r as B}from"./vendor-i18n-udtrfyWc.js";import{c as M}from"./vendor-state-routing-DFChRAiR.js";import"./vendor-ui-BcaUJBsv.js";import{pr as W,vr as q}from"./index-B3kRscgu.js";import"./gateway-client-BZvNv_1t.js";import"./index.desktop-CIjlN4kD.js";import"./platform-zuIjaMu9.js";import"./vendor-zod-BgICe4vA.js";import{Ac as L,Dc as g,Oc as R,Sc as V,kc as H,xc as J}from"./app-store-Ckqd27Cr.js";import"./environment-C7CVv9wc.js";import"./connector-store-WIJvko5l.js";import"./file-upload-ljvyVPjH.js";import"./domain-config-D6DA_TLj.js";import"./subscription-store-DeuomzKx.js";import"./open-external-fallback-CCl7zrjx.js";import"./startup-background-task-scheduler-DCkf1Wc3.js";import"./web-conversation-cache-Ca3oToox.js";import"./use-theme-DFyJ77br.js";import"./vendor-doc-tools-DkREqKq3.js";var s=j(D(),1);B();W();L();J();R();var e=j(F(),1),G={success:{title:"任务已完成 - 派发工作流-供应商调研",body:"已完成全部供应商数据采集，并整理出 12 家候选供应商的对比报告，可点击查看详情。"},permission:{title:"请求权限确认 - 派发工作流-供应商调研",body:"Agent 需要执行以下命令以继续：`curl -X POST https://api.supplier.com/v2/list?region=cn-hangzhou&category=industrial`。该接口将访问外部服务并读取供应商列表、联系方式、最近报价等敏感字段，调用过程中会带上当前账户令牌并临时写入 ~/.accio/cache/supplier-list.json 缓存目录，请确认是否允许执行；若拒绝则当前工作流会中断，已采集到的供应商对比数据不会丢失。"},error:{title:"任务失败 - 派发工作流-供应商调研",body:"调用工具 web_search 时返回 429 Too Many Requests，已重试 3 次仍失败，任务被中断。"},ask_user:{title:"Agent 想和你确认一下 - 派发工作流-供应商调研",body:"在 12 家候选供应商里，需要你确认采用哪 3 家进入第二轮报价 —— 推荐选项已经按报价 / 资质 / 交期综合打分排序，点击查看详情后即可在卡片中应答。"}},K={ok:"text-green-400",err:"text-red-400",info:"text-zinc-200"};function X(){const u=M(),{t:d}=O("common"),w=(0,s.useMemo)(()=>H(d),[d]),[k,z]=(0,s.useState)("debug-conv-001"),[b,C]=(0,s.useState)("任务已完成"),[f,_]=(0,s.useState)("这是来自 toast-debug 页面的一条测试消息。点击「查看详情」会切回主窗并尝试切换到该会话。"),[N,S]=(0,s.useState)("ACCIO Work · 调试机器人"),[y,I]=(0,s.useState)("success"),[h,v]=(0,s.useState)([]),A=(0,s.useRef)(0),l=(0,s.useRef)(null);function i(t,n="info"){const m=new Date().toISOString().slice(11,23);v(p=>{const r=[...p,{id:++A.current,ts:m,level:n,text:t}];return r.length>200?r.slice(r.length-200):r})}(0,s.useEffect)(()=>{g()?.taskComplete?i("phoenixAPI.notify 已就绪","ok"):i("phoenixAPI.notify 缺失 —— preload 未注入或当前不是 Electron 宿主","err")},[]),(0,s.useEffect)(()=>{l.current&&(l.current.scrollTop=l.current.scrollHeight)},[h]);async function a(t="",n){const m=g();if(!m?.taskComplete){i("phoenixAPI.notify.taskComplete 不可用","err");return}if(!V()){i("已被开关拦截：Settings → System → Desktop Notifications 当前为关闭","err");return}const p=(k||"debug-conv").trim()+t,r=n??y,x=G[r],$={conversationId:p,title:n?x.title:b||x.title,body:n?x.body:f||x.body,agentName:N||"ACCIO Work",timestamp:Date.now(),force:!0,kind:r,preference:"system",i18n:w};i(`调用 notify.taskComplete({ conversationId: "${p}", kind: "${r}", force: true })`);try{const o=await m.taskComplete($);i(`返回 ${JSON.stringify(o)}`,o?.ok?"ok":"err")}catch(o){i(`异常: ${o instanceof Error?o.message:String(o)}`,"err")}}async function P(){for(let t=1;t<=3;t++)await a(`-${t}`),await new Promise(n=>setTimeout(n,200))}async function E(){const t=g();if(!t?.isMainWindowFocusedAndVisible){i("isMainWindowFocusedAndVisible 不可用","err");return}try{const n=await t.isMainWindowFocusedAndVisible();i(`主窗是否聚焦且可见: ${n}`,n?"ok":"info")}catch(n){i(`查询异常: ${n instanceof Error?n.message:String(n)}`,"err")}}async function T(){try{if(typeof Notification>"u"){i("window.Notification API 不可用","err");return}if(i(`Notification.permission = "${Notification.permission}"`),Notification.permission==="default"){i("调用 Notification.requestPermission() ...");const n=await Notification.requestPermission();if(i(`requestPermission 返回 "${n}"`,n==="granted"?"ok":"err"),n!=="granted")return}else if(Notification.permission==="denied"){i("权限被拒绝。检查 main 端 setPermissionCheckHandler / 系统通知设置","err");return}const t=new Notification(b||"ACCIO 测试",{body:f||"直接调用浏览器 Notification"});t.onshow=()=>i("Notification onshow（系统已渲染）","ok"),t.onclick=()=>i("Notification onclick","ok"),t.onerror=n=>i(`Notification onerror: ${JSON.stringify(n)}`,"err"),t.onclose=()=>i("Notification onclose"),i("Notification 已 new，等待 onshow 事件...")}catch(t){i(`Notification 异常: ${t instanceof Error?t.message:String(t)}`,"err")}}return(0,e.jsx)("div",{className:"min-h-screen bg-zinc-50 dark:bg-zinc-950 px-6 py-8 overflow-y-auto",children:(0,e.jsxs)("div",{className:"max-w-3xl mx-auto",children:[(0,e.jsxs)("button",{onClick:()=>u(-1),className:"mb-4 flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors",children:[(0,e.jsx)(q,{name:"arrow-left",className:"w-4 h-4"}),"返回"]}),(0,e.jsx)("h1",{className:"text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1",children:"桌面 Toast 调试"}),(0,e.jsxs)("p",{className:"text-sm text-zinc-500 dark:text-zinc-400 mb-6",children:["直接触发 ",(0,e.jsx)("code",{className:"text-xs",children:"phoenixAPI.notify.taskComplete"})," ","（force:true 绕过主窗聚焦/偏好拦截），用于验证 main 端弹窗管线本身是否通畅。"]}),(0,e.jsxs)("section",{className:"rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 mb-4 shadow-sm",children:[(0,e.jsx)("h2",{className:"text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-4",children:"1. 弹窗参数"}),(0,e.jsxs)("div",{className:"space-y-3",children:[(0,e.jsx)(c,{label:"conversationId",children:(0,e.jsx)("input",{value:k,onChange:t=>z(t.target.value),className:"td-input",placeholder:"点「查看详情」时会 send conversation:focus"})}),(0,e.jsx)(c,{label:"title",children:(0,e.jsx)("input",{value:b,onChange:t=>C(t.target.value),className:"td-input"})}),(0,e.jsx)(c,{label:"agentName",children:(0,e.jsx)("input",{value:N,onChange:t=>S(t.target.value),className:"td-input"})}),(0,e.jsx)(c,{label:"kind",children:(0,e.jsx)("div",{className:"flex gap-3 items-center pt-1",children:["success","permission","error","ask_user"].map(t=>(0,e.jsxs)("label",{className:"flex items-center gap-1.5 cursor-pointer",children:[(0,e.jsx)("input",{type:"radio",name:"toast-kind",value:t,checked:y===t,onChange:()=>I(t)}),(0,e.jsx)("span",{className:"text-xs text-zinc-700 dark:text-zinc-300",children:t})]},t))})}),(0,e.jsx)(c,{label:"body",children:(0,e.jsx)("textarea",{value:f,onChange:t=>_(t.target.value),className:"td-input min-h-[72px] resize-y"})})]}),(0,e.jsxs)("div",{className:"mt-5 flex flex-wrap gap-2",children:[(0,e.jsx)("button",{onClick:()=>a(),className:"td-btn-primary",children:"弹出当前 kind（用上方表单）"}),(0,e.jsx)("button",{onClick:P,className:"td-btn-secondary",children:"连续弹 3 条"}),(0,e.jsx)("button",{onClick:E,className:"td-btn-secondary",children:"查询主窗是否聚焦"}),(0,e.jsx)("button",{onClick:T,className:"td-btn-secondary",children:"直接调 web Notification"})]}),(0,e.jsxs)("div",{className:"mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800",children:[(0,e.jsx)("div",{className:"text-xs text-zinc-500 dark:text-zinc-400 mb-2",children:"快速验证三种 type（用 preset 文案，忽略上方表单）："}),(0,e.jsxs)("div",{className:"flex flex-wrap gap-2",children:[(0,e.jsx)("button",{onClick:()=>a("-success","success"),className:"td-btn-kind td-btn-kind-success",children:"success"}),(0,e.jsx)("button",{onClick:()=>a("-permission","permission"),className:"td-btn-kind td-btn-kind-permission",children:"permission"}),(0,e.jsx)("button",{onClick:()=>a("-error","error"),className:"td-btn-kind td-btn-kind-error",children:"error"})]})]})]}),(0,e.jsxs)("section",{className:"rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm",children:[(0,e.jsxs)("div",{className:"flex items-center justify-between mb-3",children:[(0,e.jsx)("h2",{className:"text-base font-semibold text-zinc-900 dark:text-zinc-100",children:"2. 日志"}),(0,e.jsx)("button",{onClick:()=>v([]),className:"text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200",children:"清空"})]}),(0,e.jsx)("div",{ref:l,className:"bg-zinc-950 text-zinc-200 rounded-lg p-3 text-xs font-mono leading-relaxed max-h-80 overflow-auto",children:h.length===0?(0,e.jsx)("div",{className:"text-zinc-500",children:"(尚无日志)"}):h.map(t=>(0,e.jsxs)("div",{className:"whitespace-pre-wrap break-words",children:[(0,e.jsx)("span",{className:"text-zinc-500 mr-2",children:t.ts}),(0,e.jsx)("span",{className:K[t.level],children:t.text})]},t.id))})]}),(0,e.jsx)("style",{children:`
          .td-input {
            width: 100%;
            background: rgb(244 244 245);
            border: 1px solid rgb(228 228 231);
            color: rgb(24 24 27);
            padding: 6px 10px;
            border-radius: 6px;
            font-size: 13px;
            outline: none;
            transition: border-color 120ms;
          }
          .td-input:focus { border-color: #3B5BFF; }
          .dark .td-input {
            background: rgb(24 24 27);
            border-color: rgb(63 63 70);
            color: rgb(244 244 245);
          }
          .td-btn-primary, .td-btn-secondary {
            padding: 7px 14px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: opacity 120ms, background-color 120ms;
            border: 1px solid transparent;
          }
          .td-btn-primary { background: #3B5BFF; color: white; }
          .td-btn-primary:hover { opacity: 0.9; }
          .td-btn-secondary {
            background: rgb(244 244 245);
            color: rgb(63 63 70);
            border-color: rgb(228 228 231);
          }
          .td-btn-secondary:hover { background: rgb(228 228 231); }
          .dark .td-btn-secondary {
            background: rgb(39 39 42);
            color: rgb(228 228 231);
            border-color: rgb(63 63 70);
          }
          .dark .td-btn-secondary:hover { background: rgb(63 63 70); }
          .td-btn-kind {
            padding: 6px 14px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            color: white;
            border: none;
            transition: opacity 120ms;
          }
          .td-btn-kind:hover { opacity: 0.9; }
          .td-btn-kind-success { background: #2563EB; }
          .td-btn-kind-permission { background: #3B82F6; }
          .td-btn-kind-error { background: #DC2626; }
        `})]})})}function c({label:u,children:d}){return(0,e.jsxs)("div",{className:"flex items-start gap-3",children:[(0,e.jsx)("label",{className:"flex-shrink-0 w-28 pt-1.5 text-xs text-zinc-500 dark:text-zinc-400",children:u}),(0,e.jsx)("div",{className:"flex-1",children:d})]})}var he=X;export{X as ToastDebugPage,he as default};
