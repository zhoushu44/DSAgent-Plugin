// ==== anti_content_172432 @172432 ====
anti_content=await _();
try{
  localStorage.setItem("goodsDetail",JSON.stringify(e)),localStorage.setItem("kdds_debug_goodsDetail",JSON.stringify(e)),await o["default"].savePddProductData(e,2880),this.persistMoveTimer(e)
}
catch(u){
  
}
this.addSuccessStep("填充SKU规格");
try{
  const i={
    ...e,price_detail:t,upload_img_list:r,fill_sort_complete:!0,fill_price_complete:void 0,anti_content:e.anti_content,movingConfig:e.movingConfig,gallery:e.gallery,floor_list:e.floor_list,sku_sort:e.sku_sort,sku_key:e.sku_key,img_all_list:r
  }
  ,n=(i.gallery||[]).filter((e=>1===e?.type)).length,s=(i.gallery||[]).filter((e=>2===e?.type)).length;
  let o;
  0===s&&e.detail_img,this._pddHijackPageTrace("fillPriceTable_set_flag_start",{
    productId:i?.productId||e?.productId||"",type1:n,type2:s,skuPriceKeys:t?Object.keys(t).length:0,hasAntiContent:!!i?.anti_content
  }
  );
  try{
    o=await(0,d.N5)({
      type:"pdd_set_hijack_flag",goodsDetail:i,data:{
        goodsDetail:i
      }
      
    }
    ,15e3)
  }
  catch(p){
    throw this._pddHijackPageTrace("fillPriceTable_set_flag_fail",{
      error:p.message
    }
    ),p
  }
  if(!o||!o.success)throw this._pddHijackPageTrace("fillPriceTable_set_flag_fail",{
    error:o?.error||"未知错误"
  }
  ),new Error(o?.error||"未知错误");
  this._pddHijackPageTrace("fillPriceTable_set_flag_ok",{
    dnrO