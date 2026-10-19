// ==== applyPddMarketReferencePrice_def @66628 ====
applyPddMarketReferencePrice(e,l,c,"fillNoSpecSkuPriceDataInRequest")
}
computePddSingleBuyYuan(e,t={
  
}
){
  const r=Number.parseFloat(e);
  if(!Number.isFinite(r))return 0;
  const i=y(t.pdd_single_buy_rule_type);
  if(2===i){
    const e=Number.parseFloat(t.pdd_single_buy_fixed_yuan),i=Number.isFinite(e)?e:1;
    return Math.max(0,r+i)
  }
  const n=Number.parseFloat(t.pdd_single_buy_percent),s=(Number.isFinite(n)?n:20)/100;
  return Math.max(0,r*(1+s))
}
applyPddMarketReferencePrice(e,t,r,i="fillSkuPriceData"){
  if(!e||"object"!==typeof e)return;
  const n=Number.parseFloat(r);
  if(!Number.isFinite(n)||n<=0)return;
  const s=Number.parseFloat(t),o=n+1,[a,l]=(Number.isFinite(s),this.priceToFenAndYuan(o));
  e.market_price=a,e.market_price_in_yuan=l
}
resolveMainImagesBySourceMode(e={
  
}
,t=3){
  const r=Array.isArray(e.mainMedia)?e.mainMedia:[],i=r.filter((e=>"image"===e.type)).map((e=>e.url)).filter(Boolean),n=r.filter((e=>"mobile_image"===e.type)).map((e=>e.url)).filter(Boolean),s=Number(t||3);
  return 1===s?i.length>0?i:n:n.length>0?n:i
}
isDetailImageUploadEnabled(e={
  
}
){
  const t=e?.detail_image_upload??e?.movingConfig?.detail_image_upload;
  