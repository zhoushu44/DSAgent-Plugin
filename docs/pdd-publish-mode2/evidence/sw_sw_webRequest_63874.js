// ==== sw_webRequest_63874 @63874 ====
webRequest&&chrome.webRequest.onBeforeRequest&&chrome.webRequest.onBeforeRequest.addListener(function(e){
  var r;
  if(pddHijackTrace("webrequest_hit",{
    tabId:e.tabId,frameId:e.frameId,method:e.method,type:e.type,urlHasEdit:String(e.url||"").includes("goodsCommit/action/edit"),hasRequestBody:!(null===(r=e.requestBody)||void 0===r||null===(r=r.raw)||void 0===r||null===(r=r[0])||void 0===r||!r.bytes)
  }
  ),e.tabId<0)return pddHijackTrace("webrequest_skip_self",{
    tabId:e.tabId
  }
  ),{
    
  }
  ;
  if(processingTabIds.has(e.tabId))return pddHijackTrace("webrequest_skip_processing",{
    tabId:e.tabId
  }
  ),{
    
  }
  ;
  const t=hijackFlags[e.tabId];
  if(!t||!t.needHijack)return pddHijackTrace("webrequest_skip_no_flag",{
    tabId:e.tabId,frameId:e.frameId
  }
  ),{
    
  }
  ;
  if(Date.now()-t.timestamp>PDD_HIJACK_FLAG_TTL_MS)return pddHijackTrace("webrequest_flag_expired",{
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
      c