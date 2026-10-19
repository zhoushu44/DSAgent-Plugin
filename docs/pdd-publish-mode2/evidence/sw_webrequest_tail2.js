// ==== webrequest_tail2 @67650 ====
RequestOnce(t),l.success||l.isBizFailure||(l.errorCode=PDD_ERROR_CODE.PROXY_FALLBACK_FAIL)
}
catch(e){
  console.error("[V3 PDD] ❌ proxy 兜底异常:",e.message),l={
    success:!1,networkError:!0,error:e.message,errorCode:PDD_ERROR_CODE.PROXY_FALLBACK_FAIL,via:"proxy"
  }
  
}

}
else l.success||pddHijackTrace("no_proxy_fallback",{
  tabId:e.tabId,reason:l.isBizFailure?"biz_failure":"other",errorCode:l.errorCode||"",via:l.via||"page",status:l.status
}
);
if(l.success)return pddHijackTrace("send_final_ok",{
  tabId:e.tabId,via:l.via||"page",body:summarizePddEditBody(o)
}
),void await finishHijackSuccess(e.tabId,a,l.via||"page");
l.isBizFailure||l.errorCode===PDD_ERROR_CODE.API_BIZ?await finishHijackFailure(e.tabId,a,buildBizFailPayload(l.error_msg||l.error)):await finishHijackFailure(e.tabId,a,buildAbnormalFailPayload(l.errorCode||PDD_ERROR_CODE.SEND_NETWORK,l.error_msg||l.error||"发送失败"))
}
catch(r){
  console.error("[V3 PDD] ========== ❌ 拦截主流程异常 ==========",r),pddHijackTrace("hijack_exception",{
    tabId:e.tabId,error:(null==r?void 0:r.message)||String(r)
  }
  ),await finishHijackFailure(e.tabId,a,buildAbnormalFailPayload(PDD_ERROR_CODE.UNKNOWN,(null==r?void 0:r.message)||String(r)))
}
finally{
  processingTabIds.delete(e.tabId),await disablePddEditBlock(e.tabId),pddHijackTrace("hijack_finally",{
    tabId:e.tabId
  }
  )
}

}
)(),{
  
}

}
,{
  urls:["https://mms.pinduoduo.com/glide/mms/goodsCommit/action/edit*"]
}
,["requestBody"])
}
async function handleMessage(request,sender,sendResponse){
  const{
    type:type,cmd:cmd,data:data
  }
  =request,messageType=cmd||type;
  try{
    switch(messageType){
      case"start":const startResult=await moduleLoaderManager.handleStart(request,sender);
      return startResult;
      case"http_data":{
        const e=data&&data.requestUrl,r=applyOwnApiAuth(e,{
          
        }
        );
        if(!r.ownApi)return await fetchCorsData(e);
        try{
          const e=await fetch(r.url,{
            headers:r.headers
          }
          );
          return await e.text()
        }
        catch(e){
          return null
        }
        
      }
      case"goods_manager_permission":return{
        success:!0,allowed:isGoodsManagerAllowed()
      }
      ;
      case"get_current_cookies":return new Promise(e=>{
        chrome.cookies.getAll({
          url:data.url
        }
        ,r=>{
          e({
            args:r
          }
          )
        }
        )
      }
      );
      case"get_storage":return isDumpStorageRead(data)?{
        success:!1,error:"不允许导出全部存储"
      }
      :new Promise(e=>{
        chrome.storage.sync.get(data,r=>{
          e(r)
        }
        )
      }
      );
      case"set_storage":{
        const e=stripProtectedStorageKeys(data);
        return!e.items||"object"!=typeof e.items||Array.isArray(e.items)||0===Object.keys(e.items).length?{
          success:!1,error:"不允许写入插件身份凭证"
        }
        :new Promise(r=>{
          chrome.storage.sync.set(e.items,()=>{
            r({
              msg:"ok",success:!0
            }
            )
          }
          )
        }
        )
      }
      case"storage":try{
        const{
          action:e,keys:r
        }
        =request;
        let t;
        switch(e){
          case"remove":{
            const e=filterStorageKeys(r);
            if(0===e.allowed.length){
              t={
                success:!1,error:"不允许删除插件身份凭证"
              }
              ;
              b