// ==== sw_sendPagePddEditRequest_58940 @58940 ====
async function sendPagePddEditRequest(e,r,t,a,s=PDD_PAGE_SEND_TIMEOUT_MS){
  pddHijackTrace("send_page_start",{
    tabId:e,body:summarizePddEditBody(t),antiLen:(a||"").length,urlHasEdit:String(r||"").includes("goodsCommit/action/edit"),timeout:s
  }
  );
  let o=null;
  const n=()=>{
    null!=o&&(clearTimeout(o),o=null)
  }
  ;
  try{
    return await Promise.race([new Promise(s=>{
      chrome.tabs.sendMessage(e,{
        type:"pdd_send_modified_request",url:r,requestBody:t,antiContent:a||""
      }
      ,{
        frameId:0
      }
      ,r=>{
        if(n(),chrome.runtime.lastError)return console.error("[V3 PDD][页面代发] ❌ 消息失败:",chrome.runtime.lastError.message),pddHijackTrace("send_page_msg_fail",{
          tabId:e,error:chrome.runtime.lastError.message
        }
        ),void s({
          success:!1,networkError:!0,authOrEnvError:!0,error:chrome.runtime.lastError.message,errorCode:PDD_ERROR_CODE.SEND_NETWORK,via:"page"
        }
        );
        if(!r)return console.error("[V3 PDD][页面代发] ❌ 页面无响应"),pddHijackTrace("send_page_empty_response",{
          tabId:e
        }
        ),void s({
          success:!1,networkError:!0,authOrEnvError:!0,error:"页面代发无响应",errorCode:PDD_ERROR_CODE.SEND_NETWORK,via:"page"
        }
        );
        const t={
          success:!!r.success,status:r.status,error_msg:r.error_msg||"",error:r.error,result:r.result,networkError:!!r.networkError,authOrEnvError:!!r.authOrEnvError,isBizFailure:!!r.isBizFailure,errorCode:r.errorCode||(r.success?void 0:r.isBizFailure?PDD_ERROR_CODE.API_BIZ:PDD_ERROR_CODE.SEND_NETWORK),via:"page"
        }
        ;
        t.success?pddHijackTrace("send_page_ok",{
          tabId:e,httpStatus:t.status
        }
        ):pddHijackTrace("send_page_fail",{
          tabId:e,httpStatus:t.status,networkError:t.networkError,authOrEnvError:t.authOrEnvError,isBizFailure:t.isBizFailure,error:t.error||t.error_msg||""
        }
        ),s(t)
      }
      )
    }
    ),new Promise(r=>{
      o=setTimeout(()=>{
        o=null,console.error("[V3 PDD][页面代发] ❌ 超时",s,"ms"),pddHijackTrace("send_page_timeout",{
          tabId:e,timeout:s
        }
        ),r({
          success:!1,networkError:!0,authOrEnvError:!0,error:"页面代发超时",errorCode:PDD_ERROR_CODE.SEND_NETWORK,via:"page"
        }
        )
      }
      ,s)
    }
    )])
  }
  catch(r){
    return n(),console.error("[V3 PDD][页面代发] ❌ 异常:",(null==r?void 0:r.message)||r),pddHijackTrace("send_page_exception",{
      tabId:e,error:(null==r?void 0:r.message)||String(r)
    }
    ),{
      success:!1,networkError:!0,error:(null==r?void 0:r.message)||String(r),errorCode:PDD_ERROR_CODE.SEND_NETWORK,via:"page"
    }
    
  }
  
}
function shouldUseProxyFallb