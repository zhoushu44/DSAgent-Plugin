// ==== webrequest_tail @64650 ====
ckTrace("webrequest_flag_expired",{
  tabId:e.tabId,ageMs:Date.now()-t.timestamp
}
),delete hijackFlags[e.tabId],disablePddEditBlock(e.tabId),{
  
}
;
delete hijackFlags[e.tabId],processingTabIds.add(e.tabId);
const a=t.goodsDetail||{
  
}
;
return pddHijackTrace("hijack_process_start",{
  tabId:e.tabId,frameId:e.frameId,productId:(null==a?void 0:a.productId)||"",dnrMapped:pddBlockRuleByTab.has(e.tabId)
}
),(async()=>{
  try{
    var r;
    const t=null===(r=e.requestBody)||void 0===r||null===(r=r.raw)||void 0===r||null===(r=r[0])||void 0===r?void 0:r.bytes;
    if(!t)return console.error("[V3 PDD] ❌ requestBody 为空（可能 DNR 挡掉后个别环境无 body）"),void await finishHijackFailure(e.tabId,a,buildAbnormalFailPayload(PDD_ERROR_CODE.REQUEST_BODY_EMPTY,"webRequest.requestBody 为空"));
    const s=new TextDecoder("utf-8").decode(new Uint8Array(t));
    let o,n;
    try{
      o=JSON.parse(s)
    }
    catch(r){
      return console.error("[V3 PDD] ❌ body JSON 解析失败:",r),void await finishHijackFailure(e.tabId,a,buildAbnormalFailPayload(PDD_ERROR_CODE.REQUEST_BODY_EMPTY,"body JSON 解析失败: "+((null==r?void 0:r.message)||"")))
    }
    pddHijackTrace("body_decoded",{
      tabId:e.tabId,frameId:e.frameId,rawLen:s.length,before:summarizePddEditBody(o)
    }
    );
    try{
      if(n=await transformRequestBodyWithTimeout(e.tabId,o,a,PDD_TRANSFORM_TIMEOUT_MS),!n||"object"!=typeof n)throw Object.assign(new Error("转换结果无效"),{
        errorCode:PDD_ERROR_CODE.TRANSFORM_ERROR
      }
      );
      o=n,pddHijackTrace("transform_applied",{
        tabId:e.tabId,after:summarizePddEditBody(o)
      }
      )
    }
    catch(r){
      const t=r.errorCode||(String(r.message||"").includes("超时")?PDD_ERROR_CODE.TRANSFORM_TIMEOUT:PDD_ERROR_CODE.TRANSFORM_ERROR);
      return console.error("[V3 PDD] ❌ 改包失败，停止发包:",t,r.message),pddHijackTrace("transform_stop_no_send",{
        tabId:e.tabId,code:t,error:r.message,willUseRawBody:!1
      }
      ),void await finishHijackFailure(e.tabId,a,buildAbnormalFailPayload(t,r.message))
    }
    await new Promise(e=>setTimeout(e,2e3));
    let i="";
    try{
      i=(await chrome.cookies.getAll({
        url:PDD_MMS_ORIGIN
      }
      )).map(e=>`${e.name}=${e.value}`).join("; ")
    }
    catch(e){
      
    }
    const c=a.anti_content||"";
    await disablePddEditBlock(e.tabId),pddHijackTrace("dnr_disabled_before_page_send",{
      tabId:e.tabId,body:summarizePddEditBody(o),antiLen:(c||"").length,cookieLen:i.length
    }
    ),pddHijackTrace("before_page_send",{
      tabId:e.tabId,body:summarizePddEditBody(o),antiLen:(c||"").length,cookieLen:i.length
    }
    );
    let l=await sendPagePddEditRequest(e.tabId,e.url,o,c,PDD_PAGE_SEND_TIMEOUT_MS);
    if(!l.success&&shouldUseProxyFallback(l)){
      let r=`${PDD_MMS_ORIGIN}/`;
      try{
        const t=await chrome.tabs.get(e.tabId);
        t&&t.url&&(r=t.url)
      }
      catch(e){
        
      }
      pddHijackTrace("proxy_fallback_reason",{
        tabId:e.tabId,reason:"page_send_auth_or_network",pageStatus:l.status,pageError:l.error||l.error_msg||"",networkError:!!l.networkError,authOrEnvError:!!l.authOrEnvError,refererHost:(()=>{
          try{
            return new URL(r).host
          }
          catch(e){
            return""
          }
          
        }
        )()
      }
      );
      const t={
        method:"POST",url:e.url,data:o,headers:{
          "User-Agent":navigator.userAgent,"Content-Type":"application/json","Cache-Control":"max-age=0","Anti-Content":c,cookie:i,Origin:PDD_MMS_ORIGIN,Referer:r
        }
        
      }
      ;
      try{
        l=await sendProxy