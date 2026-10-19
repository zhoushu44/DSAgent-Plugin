// ==== antiContent_passthrough @8774 len=500 (module m_042_8087.js) ====
_pddSummarizeEditBody(t.requestBody),antiLen:(t.antiContent||"").length
}
);
try{
  const r=await this._pddPageSendModifiedEdit(t.url,t.requestBody,t.antiContent);
  window.postMessage({
    type:"pdd_send_modified_response",messageId:e,...r,source:"kdcm_pdd_publisher"
  }
  ,"*")
}
catch(i){
  this._pddHijackPageTrace("page_send_exception_postMessage",{
    messageId:e,error:i?.message||String(i)
  }
  ),window.postMessage({
    type:"pdd_send_modified_response",messageId:e,success:!1,networkError:!0,authOrEnvError:!0,error:i?.message