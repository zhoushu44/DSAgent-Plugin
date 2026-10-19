// ==== localstorage_keys_table @42395 ====
LOCALSTORAGE_KEYS,r=this._resolvePddListingAction(e),i={
  isBatch:!0,batchTaskId:String(e.batchTaskId||"").trim(),productRowId:parseInt(e.productRowId,10)||0,targetPlatform:String(e.targetPlatform||"pinduoduo").trim(),listingMethod:r,ackReported:!1,persistedAt:Date.now()
}
,n=this._readPddTimerTotalSec(e);
if(null!=n&&(i.timerTotalSec=n),i.batchTaskId&&i.productRowId>0&&i.targetPlatform)try{
  localStorage.setItem(t.BATCH_ACK_CTX,JSON.stringify(i))
}
catch(s){
  
}

}
_readBatchAckContext(){
  const e=S.LOCALSTORAGE_KEYS;
  try{
    const t=localStorage.getItem(e.BATCH_ACK_CTX);
    if(!t)return null;
    const r=JSON.parse(t);
    return r&&this.toBool(r.isBatch)?r:null
  }
  catch(t){
    return null
  }
  
}
_clearBatchAckContext(){
  const e=S.LOCALSTORAGE_KEYS;
  try{
    localStorage.removeItem(e.BATCH_ACK_CTX)
  }
  catch(t){
    
  }
  
}
_markBatchAckReported(){
  const e=this._readBatchAckContext();
  if(e){
    e.ackReported=!0,e.ackReportedAt=Date.now();
    try{
      localStorage.setIte