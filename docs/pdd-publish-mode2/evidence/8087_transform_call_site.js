// ==== transform_call_site @7960 len=700 (module m_042_8087.js) ====
transformRequestBody(t.requestBody,i);
this._pddHijackPageTrace("page_transform_ok_postMessage",{
  messageId:e,after:this._pddSummarizeEditBody(n)
}
),window.postMessage({
  type:"pdd_transform_response",messageId:e,requestBody:n,source:"kdcm_pdd_publisher"
}
,"*")
}
catch(i){
  this._pddHijackPageTrace("page_transform_fail_postMessage",{
    messageId:e,error:i?.message||String(i)
  }
  ),window.postMessage({
    type:"pdd_transform_response",messageId:e,error:i.message,source:"kdcm_pdd_publisher"
  }
  ,"*")
}
finally{
  this._pddReleaseMessageId(e,"postMessage_transform")
}

}
else if(t&&"pdd_send_modified_request"===t.type&&"kdcm_extension_v3"===t.source){
  const e=t.messageId;
  if(!this._pddTryClaimMessageId(e,"postMessage_send"))retur