// ==== getPddStockMode_def @61970 ====
getPddStockMode(e){
  if(!e||"object"!==typeof e)return 1;
  const t=e.movingConfig||{
    
  }
  ;
  return 2===Number(t.stock_mode??e.stock_mode??1)?2:1
}
getPddCustomInventory(e){
  if(!e||"object"!==typeof e)return 0;
  const t=e.movingConfig||{
    
  }
  ,r=t.inventory??e.inventory;
  if(null==r||""===r)return 0;
  const i=parseInt(String(r),10);
  return isNaN(i)?0:i
}
_peekStockFromPriceData(e){
  if(!e||"object"!==typeof e)return null;
  if(void 0!==e.stock&&""!==e.stock){
    const t=parseInt(String(e.stock),10);
    return isNaN(t)?null:t
  }
  if(void 0!==e.quantity&&""!==e.quantity){
    const t=parseInt(String(e.quantity),10);
    return isNaN(t)?null:t
  }
  if(void 0!==e.inventory&&""!==e.inventory){
    const t=parseInt(String(e.inventory),10);
    return isNaN(t)?null:t
  }
  return null
}
applyCustomStockToSkuPrice(e,t){
  if(!e||"object"!==typeof e)return 0;
  const r=parseInt(String(t),10),i=isNaN(r)?0:r,n=e.sku_price;
  if(!n||"object"!==typeof n||Array.isArray(n))return 0;
  let s