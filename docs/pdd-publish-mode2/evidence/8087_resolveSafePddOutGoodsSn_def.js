// ==== resolveSafePddOutGoodsSn_def @115234 ====
resolveSafePddOutGoodsSn(e,t={
  
}
){
  const r=S.PDD_OUT_GOODS_SN_MAX_WEIGHTED_LEN,i=String(null!=t.productCode_radio&&""!==t.productCode_radio?t.productCode_radio:null!=e?.productCode_radio?e.productCode_radio:"1"),n=String(e?.goods_id||e?.productId||"").trim();
  let s="",o="empty";
  if("2"===i)s=String(e?.goods_id||e?.productId||"").trim(),o="goods_id";
  else if("3"===i)s=String(e?.base_attr&&e.base_attr["货号"]||"").trim(),o="base_attr.货号";
  else{
    if("4"!==i)return"";
    s=String(e?.goods_url||e?.productUrl||"").trim(),o="goods_url"
  }
  if(!s)return"";
  try{
    const e=this.truncateByChineseEnglishLength(s,r);
    if(!e.value){
      if(n){
        const e=this.truncateByChineseEnglishLength(n,r);
        return e.value
      }
      return""
    }
    return e.truncated,e.value
  }
  catch(a){
    a&&a.message?a.message:String(a);
    if(n)try{
      const e=this.truncateByChineseEnglishLength(n,r);
      return e.value
    }
    catch(l){
      return""
    }
    return""
  }
  
}
async _fillPddPublishPageBrand(e,t,r={
  
}
){
  const i=String(e.value||"").trim(),n=String(t.base_attr&&t.base_attr["品牌"]||"").trim();
  if(i)return{
    ok:!0,result:"kept_existing",picked:i
  }
  ;
  const s={
    brand_type:t.brand_type,brand_custom_name:t.brand_custom_name
  }
  ;
  return await this._fillPddBrandField(e,s,n,"publish_page")
}
async fillSingleAttribute(e,t,r,i=!1){
  if("适用场景"===e)return;
  const n=t.getElementsByTagName("input");
  if(0===n.length)return;
  const s=t.children[0]?.children[0]?.textContent||"";
  if(i){
    if(S.filledAttrNames.includes(s))return
  }
  else S.filledAttrNames.push(s);
  if(!i){
    if((n[0].disabled||""!==n[0].value&&s!==e)&&"on"!==n[0].value)return;
    if(n[0].parentElement?.previousElementSibling)return
  }
  const o=i?"000":r.base_attr?.[e]||"";
  if("checkbox"!==n[0].type)if("beast-core-input-htmlInput"!==n[0].dataset.testid){
    if("beast-core-select-htmlInput"===n[0].dataset.testid){
      const t=String(s||"").replace(/^重要/,"").replace(/\*/g,"").trim();
      if("品牌"===t&&("品牌"===e||i))return void await this._fillPddPublishPageBrand(n[0],r,{
        attrKey:e,isRequired:i
      }
      );
      const l="品牌"===e,c=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;
      n[0].click(),await a.sleep(100);
      let u=i?"":o.replaceAll("，",",");
      u=u.includes(",")?u.split(","):[u];
      for(let e of u){
        e=e.replace(/\([^)]*\)|（[^）]*）/g,""),c.call(n[0],e),n[0].dispatchEvent(new Event("input",{
          bubbles: