// ==== sw_dnr_update_52926 @52926 ====
chrome.declarativeNetRequest)||void 0===r||!r.updateSessionRules)return console.error("[V3 PDD][DNR] ❌ declarativeNetRequest.updateSessionRules 不可用，无法挡原请求"),{
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
    tabId:e,success:!!t.success,errorCode:t.errorCode||"",detailMessage:t.detailMessage||""
  }
  ),new Promise(r=>{
    try{
      chrome.tabs.sendMessage(e,t,{
        frameId:0
      }
      ,t=>{
        if(chrome.runtime.lastError)return pddHijackTrace("notify_result_fail",{
          tabId:e,error:chrom