// ==== fillShippingConfig_def @265416 ====
fillShippingConfig(e,t){
  const r=t.movingConfig||{
    
  }
  ;
  if(r.template&&(e.cost_template_id=r.template,e.is_default_template_id=1),r.selectTime){
    const t=r.selectTime;
    let i=86400;
    "today"===t||"1"===t||"24h"===t||"2"===t?i=86400:"48h"!==t&&"3"!==t||(i=172800),e.shipment_limit_second=i
  }
  let i=t?.sku_multi_discount||r?.sku_multi_discount,n="number"!==typeof i||isNaN(i)?9.9:i;
  (n<5||n>9.9)&&(n=9.9),e.two_pieces_discount=Math.round(10*n)
}
extractPrice(e){
  return"object"===typeof e&&void 0!==e.price?parseFloat(e.price):"number"===typeof e?e:"string"===typeof e?parseFloat(e):0
}
_readExplicitStockNumber(e){
  if(!e||"object"!==typeof e)return null;
  const t=["stock","quantity","inventory"];
  for(const r of t){
    const t=e[r];
    if(void 0===t||null===t||""===t)continue;
    const i=parseInt(String(t),10);
    if(!isNaN(i))return i
  }
  return null
}
applyResolvedStockToCommitSku(e,t){
  const r=parseInt(String(t),10),i=!isNaN(r)&&r>0?r:0,n=i>0?1:0;
  return delete e.quantity,e.quantity_delta=i,e.is_onsale=n,{
    quantity:i,isOnsale:n,statusText: