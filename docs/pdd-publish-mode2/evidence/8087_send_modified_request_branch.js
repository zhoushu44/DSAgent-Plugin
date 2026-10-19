// ==== send_modified_request_branch @8513 ====
pdd_send_modified_request"===t.type&&"kdcm_extension_v3"===t.source){
  const e=t.messageId;
  if(!this._pddTryClaimMessageId(e,"postMessage_send"))return;
  this._pddHijackPageTrace("page_send_recv_postMessage",{
    messageId:e,url:String(t.url||"").slice(0,160),body:this._pddSummarizeEditBody(t.requestBody),antiLen:(t.antiContent||"").length
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
      type:"pdd_send_modified_response",messageId:e,