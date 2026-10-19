// ==== sw_finish_success_failure_62294 @62294 ====
function buildAbnormalFailPayload(e,r){
  return{
    success:!1,errorCode:e,userMessage:USER_MSG_ABNORMAL,detailMessage:`${USER_MSG_ABNORMAL} | ${e}${r?` | ${
      r
    }
    `:""}`,pddErrorMsg:""
  }
  
}
function buildBizFailPayload(e){
  const r=e||"未知错误",t=`${USER_MSG_BIZ_PREFIX}${r}`,a=`${t} | ${PDD_ERROR_CODE.API_BIZ}`;
  return{
    success:!1,errorCode:PDD_ERROR_CODE.API_BIZ,userMessage:t,detailMessage:a,pddErrorMsg:r
  }
  
}
async function finishHijackFailure(e,r,t){
  console.error("[V3 PDD] ========== ❌ 劫持失败收尾 ==========",t),pddHijackTrace("finish_fail",{
    tabId:e,errorCode:(null==t?void 0:t.errorCode)||"",detailMessage:(null==t?void 0:t.detailMessage)||"",productId:(null==r?void 0:r.productId)||""
  }
  );
  try{
    if(r&&"object"==typeof r){
      const t=void 0!==r.fill_price_complete;
      t&&delete r.fill_price_complete,pddHijackTrace("finish_fail_no_persist_false",{
        tabId:e,productId:r.productId||"",clearedExistingFlag:t
      }
      ),await updateGoodsDetailInLocalStorage(e,r)
    }
    
  }
  catch(e){
    
  }
  await disablePddEditBlock(e),await notifyPageHijackResult(e,t)
}
async function finishHijackSuccess(e,r,t){
  pddHijackTrace("finish_success",{
    tabId:e,via:t,productId:(null==r?void 0:r.productId)||"",fill_price_complete:!0
  }
  ),r.fill_price_complete=!0,await updateGoodsDetailInLocalStorage(e,r)||pddHijackTrace("finish_success_storage_warn",{
    tabId:e,via:t
  }
  ),await disablePddEditBlock(e),await notifyPageHijackResult(e,{
    success:!0,errorCode:"",userMessage:"",detailMessage:`劫持填价成功 | via=${t}`,pddErrorMsg:""
  }
  ),await new Promise(e=>setTimeout(e,300)),pddHijackTrace("reload_start",{
    tabId:e,via:t
  }
  ),chrome.tabs.reload(e)
}
function registerPddInterceptor(){
  chrome.webRequest&&chrome.w