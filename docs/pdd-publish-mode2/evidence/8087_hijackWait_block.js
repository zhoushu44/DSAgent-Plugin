// ==== hijackWait_block @168300 ====
eTrace("page_hijack_result",{
  ...t,hasWaitPromise:!(!this._pddHijackWait||this._pddHijackWait.settled)
}
),this._pddHijackWait&&!this._pddHijackWait.settled)return clearTimeout(this._pddHijackWaitTimer),this._pddHijackWait.settled=!0,void this._pddHijackWait.resolve(t);
if(!t.success){
  this._pddHijackPageTrace("page_hijack_result_no_wait",t);
  let e=null;
  try{
    const t=localStorage.getItem("goodsDetail");
    e=t?JSON.parse(t):null
  }
  catch(r){
    
  }
  this.handlePddHijackFailure(e||{
    
  }
  ,t).catch((e=>{
    
  }
  ))
}

}
_waitPddHijackResult(e=12e4){
  return this._pddHijackPageTrace("page_wait_hijack_start",{
    timeoutMs:e
  }
  ),new Promise((t=>{
    this._pddHijackWait={
      resolve:t,settled:!1
    }
    ,this._pddHijackWaitTimer=setTimeout((()=>{
      this._pddHijackWait&&!this._pddHijackWait.settled&&(this._pddHijackWait.settled=!0,this._pddHijackPageTrace("page_wait_hijack_timeout",{
        timeoutMs:e
      }
      ),t({
        success:!1,errorCode:"PDD_TRANSFORM_TIMEOUT",userMessage:"拼多多数据解析异常，请联系客服。",detailMessage:"拼多多数据解析异常，请联系客服。 | PDD_HIJACK_WAIT_TIMEOUT",pddErrorMsg:""
      }
      ))
    }
    ),e)
  }
  ))
}
_pddGetSessionIdentity(e){
  return e&&"object"===typeof e?{
    productId:String(e.productId||e.cjProductId||""),goods_id:String(e.goods_id||e.goodsId||""),goods_commit_id:String(e.goods_commit_id||e.goodsCommitId||"")
  }
  :{
    productId:"",goods_id:"",goods_commit_id:""
  }
  
}
_pddIsSameHijackSession(e,t){
  const r=thi