// ==== summarizeEditBody_def @165410 len=3000 (module m_042_8087.js) ====
_pddSummarizeEditBody(e){
  if(!e||"object"!==typeof e)return{
    empty:!0
  }
  ;
  const t=Array.isArray(e.gallery)?e.gallery:[],r=Array.isArray(e.skus)?e.skus:[];
  let i=0;
  for(let n=0;
  n<r.length;
  n++){
    const e=r[n]||{
      
    }
    ;
    (Number(e.multi_price)>0||Number(e.price)>0)&&i++
  }
  return{
    type1:t.filter((e=>e&&1===e.type)).length,type2:t.filter((e=>e&&2===e.type)).length,skus:r.length,skusPriced:i,is_draft:e.is_draft,goods_id:e.goods_id,goods_commit_id:e.goods_commit_id
  }
  
}
async _pddPageSendModifiedEdit(e,t,r){
  const i=String(e||"").slice(0,160);
  this._pddHijackPageTrace("page_send_start",{
    url:i,body:this._pddSummarizeEditBody(t),antiLen:(r||"").length
  }
  );
  try{
    const i=await fetch(e,{
      method:"POST",headers:{
        "Content-Type":"application/json","Anti-Content":r||""
      }
      ,body:JSON.stringify(t),credentials:"include"
    }
    ),s=await i.text();
    if(!s||!String(s).trim())return this._pddHijackPageTrace("page_send_fail",{
      reason:"empty_body",status:i.status
    }
    ),{
      success:!1,networkError:!0,authOrEnvError:!0,status:i.status,error:"空 body",errorCode:"PDD_SEND_NETWORK",via:"page"
    }
    ;
    let o=null;
    try{
      o=JSON.parse(s)
    }
    catch(n){
      return this._pddHijackPageTrace("page_send_fail",{
        reason:"non_json",status:i.status,preview:String(s).slice(0,120)
      }
      ),{
        success:!1,networkError:!0,authOrEnvError:!0,status:i.status,error:"非 JSON: "+(n?.message||String(n)),errorCode:"PDD_SEND_NETWORK",via:"page"
      }
      
    }
    if(401===i.status||403===i.status)return this._pddHijackPageTrace("page_send_fail",{
      reason:"auth_http",status:i.status,error_msg:o?.error_msg||o?.errorMsg||""
    }
    ),{
      success:!1,networkError:!0,authOrEnvError:!0,status:i.status,error_msg:o?.error_msg||o?.errorMsg||`HTTP ${i.status}`,result:o,errorCode:"PDD_SEND_NETWORK",via:"page"
    }
    ;
    if(o&&!0===o.success)return this._pddHijackPageTrace("page_send_ok",{
      status:i.status
    }
    ),{
      success:!0,status:i.status,result:o,via:"page"
    }
    ;
    const a=o?.error_msg||o?.errorMsg||"业务失败";
    return this._pddHijackPageTrace("page_send_fail",{
      reason:"biz",status:i.status,error_msg:a
    }
    ),{
      success:!1,isBizFailure:!0,status:i.status,error_msg:a,result:o,errorCode:"PDD_API_BIZ",via:"page"
    }
    
  }
  catch(s){
    return this._pddHijackPageTrace("page_send_fail",{
      reason:"network",error:s?.message||String(s)
    }
    ),{
      success:!1,networkError:!0,authOrEnvError:!0,error:s?.message||String(s),errorCode:"PDD_SEND_NETWORK",via:"page"
    }
    
  }
  
}
_pddHijackPageTrace(e,t={
  
}
){
  const r={
    t:Date.now(),iso:(new Date).toISOString(),step:e,from:"page",href:String(location.href||"").slice(0,180),...t
  }
  ;
  try{
    const e="pdd_hijack_trace_page",t=localStorage.getItem(e),i=t?JSON.parse(t):[],n=Array.isArray(i)?i:[];
    n.push(r);
    while(n.length>60)n.shift();
    localStorage.setItem(e,JSON.stringify(n))
  }
  catch(i){
    
  }
  try{
    (0,d.N5)({
      type:"pdd_hijack_trace_append",step:e,data:t
    }
    ,5e3).catch((()=>{
      
    }
    ))
  }
  catch(i){
    
  }
  
}
_onPddHijackResultMessage(e){
  const t={
    success:!!e.success,errorCode:e.errorCode||"",userMessage:e.userMessage||"",detailMessage:e.detailMessage||"",pddErrorMsg:e.pddErrorMsg||""
  }
  ;
  if(this._pddHijackPageTrace("page_hijack_result",{
    ...t,hasWaitPromise:!(!this._pddHijackWait||this._pddHijackWait.settled)
  }
  ),this._