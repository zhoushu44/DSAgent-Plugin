// ==== transform_request_body_handler @10305 len=700 (module m_042_8087.js) ====
pdd_transform_request_body"===t.type)return e._pddHijackPageTrace("page_transform_ignore_runtime",{
  reason:"use_postMessage_channel"
}
),i({
  success:!1,ignored:!0,error:"use_postMessage_channel"
}
),!0;
if("pdd_save_to_indexeddb"===t.type)return(async()=>{
  try{
    await o["default"].savePddProductData(t.data,60),i({
      success:!0
    }
    )
  }
  catch(n){
    i({
      success:!1,error:n.message
    }
    )
  }
  
}
)(),!0;
if("pdd_get_from_indexeddb"===t.type)return(async()=>{
  try{
    const e=await o["default"].getPddProductData();
    i({
      success:!0,data:e
    }
    )
  }
  catch(n){
    i({
      success:!1,error:n.message,data:null
    }
    )
  }
  
}
)(),!0;
if("pdd_get_cookies"===t.type){
  try{
    const e=document.cookie;
    i(e)
  }
  catch(n){
    i("")
  }
  return!0
}
return"pdd_send_modified_request"===t.type&&(e._pddHijackP