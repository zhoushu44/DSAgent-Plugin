// ==== sw_hijack_goods_commit_51753 @51753 ====
goods_commit_id:e.goods_commit_id
}

}
async function pddHijackTrace(e,r={
  
}
){
  const t={
    t:Date.now(),iso:(new Date).toISOString(),step:e,...r
  }
  ;
  try{
    var a;
    if(null===(a=chrome)||void 0===a||null===(a=a.storage)||void 0===a||!a.local)return t;
    const e=await chrome.storage.local.get([PDD_TRACE_KEY]),r=Array.isArray(e[PDD_TRACE_KEY])?e[PDD_TRACE_KEY]:[];
    for(r.push(t);
    r.length>PDD_TRACE_MAX;
    )r.shift();
    await chrome.storage.local.set({
      [PDD_TRACE_KEY]:r
    }
    )
  }
  catch(e){
    
  }
  return t
}
const PDD_TRANSFORM_TIMEOUT_MS=3e4,PDD_PAGE_SEND_TIMEOUT_MS=3e4,PDD_MMS_ORIGIN="https://mms.pinduoduo.com",PDD_HIJACK_FLAG_TTL_MS=3e5,PDD_BLOCK_RULE_BASE=91e4,PDD_EDIT_URL_FILTER="mms.pinduoduo.com/glide/mms/goodsCommit/action/edit",pddBlockRuleByTab=new Map,USER_MSG_ABNORMAL="拼多多数据解析异常，请联系客服。",USER_MSG_BIZ_PREFIX="拼多多数据解析失败，请联系客服。原因：",PDD_ERROR_CODE={
  TRANSFORM_TIMEOUT:"PDD_TRANSFORM_TIMEOUT",TRANSFORM_ERROR:"PDD_TRANSFORM_ERROR",REQUEST_BODY_EMPTY:"PDD_REQUEST_BODY_EMPTY",SEND_NETWORK:"PDD_SEND_NETWORK",PROXY_FALLBACK_FAIL:"PDD_PROXY_FALLBACK_FAIL",API_BIZ:"PDD_API_BIZ",UNKNOWN:"PDD_UNKNOWN"
}
;
async function enablePddEditBlock(e){
  var r;
  if(!e&&0!==e)return{
    success:!1,error:"invalid_tabId"
  }
  ;
  if(null===(r=chrome.declarativeNetRequest)||void 0===r||!r.updateSessionRules)return console.error("[V3 PDD][DNR] ❌ declarativeNetRequest.updateSessionRules 不可用，无法挡原请求"),{
    success:!1,error:"dnr_unavailable"
  }
  ;
  await disablePddEditBlock(e);
  const t=PDD_BLOCK_RULE_BASE+Number(e)%1e3,a={
    id:t,priority:2,action:{
      type:"block"
    }
    ,condition:{
      urlFilter:PDD_EDIT_URL_FILTER,resourceTypes:["xmlhttprequest","other"],tabIds:[e]
    }
    
  }
  ;
  try{
    return await chrome.declarativeNetRequest.updateSessionRules({
      addRules:[a],removeRuleIds:[]
    }
    ),pddBlockRuleByTab.set(e,t),pddHijackTrace("dnr_enable_ok",{
      tabId:e,ruleId:t
    }
    ),{
      success:!0,ruleId:t
    }
    
  }
  catch(r){
    return console.error("[V3 PDD][DNR] ❌ 挂 block 规则失败:",(null==r?void 0:r.message)||r,r),pddHijackTrace("dnr_enable_fail",{
      tabId:e,error:(null==r?void 0:r.message)||String(r)
    }
    ),{
      success:!1,error:(null==r?void 0:r.message)||String(r)
    }
    
  }
  
}
async function disablePddEditBlock(e){
  var r;
  if(!e&&0!==e)return{
    success:!0
  }
  ;
  const t=pddBlockRuleByTab.get(e),a=t?[t]:[PDD_BLOCK_RULE_BASE+Number(e)%1e3];
  if(pddBlockRuleByTab.delete(e),null===(r=chrome.declarativeNetRequest)||void 0===r||!r.updateSessionRules)return{
    success:!0
  }
  ;
  try{
    return await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds:a
    }
    ),pddHijackTrace("dnr_disable_ok",{
      tabId:e,removeIds:a
    }
    ),{
      success:!0
    }
    
  }
  catch(r){
    return pddHijackTrace("dnr_disable_fail",{
      tabId:e,error:(null==r?void 0:r.message)||String(r)
    }
    ),{
      success:!1,error:(null==r?void 0:r.message)||String(r)
    }
    
  }
  
}
async function notifyPageHijackResult(e,r){
  const t={
    type:"pdd_hijack_result",...r
  }
  ;
  return pddHijackTrace("notify_result",{
    tabId:e,success:!!t.success,errorCode:t.errorCode||"",detailMessage:t.de