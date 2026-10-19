// ==== sw_handlePddSetHijackFlag_87605 @87605 ====
async function handlePddSetHijackFlag(e,r,t={
  
}
){
  var a;
  const s=null===(a=r.tab)||void 0===a?void 0:a.id,o=(null==e?void 0:e.goodsDetail)||(null==t?void 0:t.goodsDetail)||null,n=Array.isArray(null==o?void 0:o.gallery)?o.gallery:[];
  if(pddHijackTrace("set_hijack_flag_recv",{
    tabId:s||null,frameId:r.frameId,hasGoodsDetail:!(!o||"object"!=typeof o),productId:(null==o?void 0:o.productId)||"",type1:n.filter(e=>e&&1===e.type).length,type2:n.filter(e=>e&&2===e.type).length,skuPriceKeys:null!=o&&o.price_detail?Object.keys(o.price_detail).length:0,hasAntiContent:!(null==o||!o.anti_content)
  }
  ),s){
    if(!o||"object"!=typeof o)return console.error("[V3 PDD] ❌ goodsDetail 缺失，拒绝设置劫持标志",{
      hasData:!!e,hasRequestGoodsDetail:!(null==t||!t.goodsDetail)
    }
    ),pddHijackTrace("set_hijack_flag_reject",{
      tabId:s,reason:"goodsDetail_missing"
    }
    ),{
      success:!1,error:"goodsDetail 缺失"
    }
    ;
    hijackFlags[s]={
      needHijack:!0,goodsDetail:o,timestamp:Date.now()
    }
    ;
    const r=await enablePddEditBlock(s);
    return r.success?(pddHijackTrace("set_hijack_flag_ok",{
      tabId:s,dnrRuleId:r.ruleId,productId:(null==o?void 0:o.productId)||""
    }
    ),{
      success:!0,dnr:r
    }
    ):(console.error("[V3 PDD] ❌ DNR block 挂载失败，回滚劫持标志:",r.error),delete hijackFlags[s],pddHijackTrace("set_hijack_flag_dnr_fail",{
      tabId:s,error:r.error||"unknown"
    }
    ),{
      success:!1,error:"DNR block 挂载失败: "+(