// ==== sw_transform_timeout_55198 @55198 ====
async function transformRequestBodyWithTimeout(e,r,t,a=PDD_TRANSFORM_TIMEOUT_MS){
  const s=summarizePddEditBody(r);
  pddHijackTrace("transform_send",{
    tabId:e,frameId:0,timeout:a,before:s,goodsHasGallery:Array.isArray(null==t?void 0:t.gallery),goodsType1:Array.isArray(null==t?void 0:t.gallery)?t.gallery.filter(e=>e&&1===e.type).length:0,goodsType2:Array.isArray(null==t?void 0:t.gallery)?t.gallery.filter(e=>e&&2===e.type).length:0,skuPriceKeys:null!=t&&t.price_detail?Object.keys(t.price_detail).length:0
  }
  );
  try{
    await chrome.tabs.get(e)
  }
  catch(r){
    console.error("[transformRequestBodyWithTimeout] ❌ Tab 不可访问:",r.message),pddHijackTrace("transform_tab_unreachable",{
      tabId:e,error:r.message
    }
    );
    const t=new Error(`Tab ${e} 不存在或无法访问: ${r.message}`);
    throw t.errorCode=PDD_ERROR_CODE.TRANSFORM_ERROR,t
  }
  let o=null;
  return Promise.race([new Promise((a,n)=>{
    chrome.tabs.sendMessage(e,{
      type:"pdd_transform_request_body",requestBody:r,goodsDetail:t,useLocalGoodsDetailFallback:!0
    }
    ,{
      frameId:0
    }
    ,r=>{
      if(null!=o&&(clearTimeout(o),o=null),chrome.runtime.lastError){
        console.error("[transformRequestBodyWithTimeout] ❌ 消息失败:",chrome.runtime.lastError.message),pddHijackTrace("transform_msg_fail",{
          tabId:e,error:chrome.runtime.lastError.message
        }
        );
        const r=new Error(chrome.runtime.lastError.message);
        return r.errorCode=PDD_ERROR_CODE.TRANSFORM_ERROR,void n(r)
      }
      if(r&&r.success){
        const t=summarizePddEditBody(r.requestBody);
        return