// ==== getOrderedSkuKeyIdsWithPrice_def @140195 ====
getOrderedSkuKeyIdsWithPrice(e){
  const t=e.sku_key||{
    
  }
  ,r=e.sku_price||{
    
  }
  ;
  let i=e.sku_key_list?.length?e.sku_key_list.slice():Object.keys(t);
  if(!e.sku_key_list?.length){
    const e=i.every((e=>/^-?\d+$/.test(String(e))));
    e||(i=i.slice().sort(((e,t)=>String(e).localeCompare(String(t),"zh-Hans-CN"))))
  }
  return i.filter((e=>null!=t[e]&&this.normalizeSkuPriceRecord(r[e])))
}
specTextsLookLikeRowCodePlaceholders(e){
  const t=(e||[]).map((e=>String(e||"").trim())).filter(Boolean);
  return 0!==t.length&&t.every((e=>/^[0-9]{
    1,12
  }
  $/.test(e)))
}
fuzzyMatchPriceDetailLeafOnly(e,t,r){
  if(!e||"object"!==typeof e)return null;
  for(const i of Object.keys(e)){
    const n=this.cleanSpecName(i);
    if(!(n===r||n===t||i.includes(t)||t.includes(i)||n.includes(r)||r.includes(n)))continue;
    const s=e[i];
    if(this.isSkuPriceLeaf(s))return s;
    const o=this.pickSingleNestedPriceLeaf(s);
    if(o)return o
  }
  return null
}
normalizeAddSpecTypeBtnText(e){
  return(e?.innerText||"").replace(/\s/g,"").replace(/^\+/,"").trim()
}
isAddSpecTypeButton(e){
  if(!e||"BUTTON"!==e.tagName)return!1;
  const t=this.normalizeAddSpecTypeBtnText(e);
  return!!t&&(!t.includes("AI添加")&&t.includes("添加规格类型"))
}
getPageAddSpecTypeButton(e={
  
}
){
  const t=!1!==e.allowDisabled,r=(e.silent,e=>!!this.isAddSpecTypeButton(e)&&!(!t&&e.disabled)),i=[],n=(e,t)=>{
    if(i.length>=8)return;
    const r=this.normalizeAddSpecTypeBtnText(e).slice(0,24);
    r&&!r.includes("添加规格类型")&&(/本地上传|AI|上传|排序/.test(r)||i.length<3)&&i.push({
      where:t,text:r,disabled:!!e.disabled
    }
    )
  }
  ,s=document.querySelectorAll(".goods-sku-box");
  for(let c=0;
  c<s.length;
  c++){
    const e=s[c];
    for(let t=0;
    t<e.children.length;
    t++){
      const i=e.children[t];
      if("BUTTON"===i.tagName){
        if(r(i))return i;
        n(i,`sku-box[${c}]>button`)
      }
      
    }
    
  }
  const o=[],a=document.querySelector("#newSpec");
  a&&o.push({
    name:"#newSpec",el:a
  }
  ),s.forEach(((e,t)=>o.push({
    name:`.goods-sku-box[${t}]`,el:e
  }
  )));
  for(const c of o){
    const e=c.el.querySelectorAll("button");
    for(let t=0;
    t<e.length;
    t++){
      const i=e[t];
      if(r(i))return i;
      n(i,`${c.name} button[${t}]`)
    }
    
  }
  const l=document.querySelectorAll(