// ==== sw_dnr_88623 @88623 ====
dnrRuleId:r.ruleId,productId:(null==o?void 0:o.productId)||""
}
),{
  success:!0,dnr:r
}
):(console.error("[V3 PDD] ❌ DNR block 挂载失败，回滚劫持标志:",r.error),delete hijackFlags[s],pddHijackTrace("set_hijack_flag_dnr_fail",{
  tabId:s,error:r.error||"unknown"
}
),{
  success:!1,error:"DNR block 挂载失败: "+(r.error||"unknown"),dnr:r
}
)
}
return console.error("[V3 PDD] ❌ 无法获取 tabId"),pddHijackTrace("set_hijack_flag_reject",{
  reason:"no_tabId"
}
),{
  success:!1,error:"无法获取 tabId"
}

}
async function handlePddClearHijackFlag(e){
  var r;
  const t=null===(r=e.tab)||void 0===r?void 0:r.id;
  return t&&hijackFlags[t]&&delete hijackFlags[t],t&&await disablePddEditBlock(t),{
    success:!0
  }
  
}
async function handleInjectDependencies(e){
  var r,t;
  const a=null===(r=e.tab)||void 0===r?void 0:r.id;
  if(!a)return{
    success:!1,error:"无法获取 tabId"
  }
  ;
  if(null!==(t=injectionStatus[a])&&void 0!==t&&t.dependencies)return{
    success:!0,alreadyInjected:!0
  }
  ;
  try{
    var s;
    const e