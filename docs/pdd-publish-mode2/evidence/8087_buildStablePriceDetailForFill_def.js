// ==== buildStablePriceDetailForFill_def @124570 ====
buildStablePriceDetailForFill(e){
  const t=e.sku_sort||[],r=e.sku_key||{
    
  }
  ,i=e.sku_price||{
    
  }
  ;
  let n=t.length;
  const s=Object.keys(r)[0],o=s?r[s]:null;
  if((n<=0||n>2)&&Array.isArray(o)&&o.length&&(n=o.length>=2?2:1),n<=0||n>2)return null;
  const a=e.sku_key_list?.length?e.sku_key_list:Object.keys(r),l={
    
  }
  ;
  if(1===n){
    for(const e of a){
      const t=r[e];
      if(!Array.isArray(t)||t.length<1)continue;
      const n=i[e];
      if(void 0===n||null===n)continue;
      const s=String(t[0]||"").trim();
      if(!s)continue;
      const o="object"===typeof n&&null!==n?n:{
        price:n
      }
      ;
      l[s]=o
    }
    return Object.keys(l).length?l:null
  }
  for(const c of a){
    const e=r[c];
    if(!Array.isArray(e)||e.length<2)continue;
    const t=i[c];
    if(void 0===t||null===t)continue;
    const n=String(e[0]||"").trim(),s=String(e[1]||"").trim();
    if(!n||!s)continue;
    const o="object"===typeof t&&null!==t?t:{
      price:t
    }
    ;
    l[n]||(l[n]={
      
    }
    ),l[n][s]=o
  }
  return Object.keys(l).length?l:null
}
isEmptyPriceDetailTable(e){
  if(!e||"object"!==typeof e)return!0;
  for(const t of Object.keys(e)){
    const r=e[t];
    if(r&&"object"===typeof r){
      if(void 0!==r.price)return!1;
      for(const e of Object.keys(r)){
        const t=r[e];
        if(t&&"object"===typeof t&&void 0!==t.price)return!1
      }
      
    }
    
  }
  return!0
}
dimMatchSkuToSpec(e,t){
  const r=String(e??""),i=String(t??"");
  if(!r||!i)return!1;
  if(r===i)return!0;
  const n=this.cleanSkuMatchKey(r),s=this.cleanSkuMatchKey(i);
  return!(!n||!s)&&(n===s||(this.fuzzyMatch(n,s)||this.fuzzyMatch(r,i)))
}
findTwoDimPriceFromSkuMatrixUnordered(e,t){
  const r=e.sku_price||{
    
  }
  ,i=e.sku_key||{
    
  }
  ,n=e.sku_key_list?.length?e.sku_key_list:Object.keys(i),s=t[0]||"",o=t[1]||"";
  if(!s||!o)return null;
  for(const a of n){
    const e=i[a];
    if(!Array.isArray(e)||e.length<2)continue;
    const t=e[0],n=e[1],l=this.dimMatchSkuToSpec(t,s)&&this.dimMatchSkuToSpec(n,o),c=this.dimMatchSkuToSpec(t,o)&&this.dimMatchSkuToSpec(n,s);
    if(!l&&!c)continue;
    const u=r[a];
    if(void 0!==u&&null!==u)return"object"===typeof u&&null!==u?u:{
      price:u
    }
    
  }
  return null
}
_commitSpecValueMatches(e,t){
  const r=String(e??"").trim(),i=String(t??"").trim();
  if(!r||!i)return!1;
  const n=this.cleanSpecName(r),s=this.cleanSpecName(i);
  return r===i||n===s||i.includes(r)||r.includes(i)||s.includes(n)||n.includes(s)||this.dimMatchSkuToSpec(i,r)
}
_commitSpecTextsMatchRowList(e,t){
  if(!e?.length||!t?.length||e.length!==t.length)return!1;
  for(let r=0;
  r<e.length;
  r++)if(!this._commitSpecValueMatches(e[r],t[r]))return!1;
  return!0
}
_resolvePddSkuKeyPathByCombinedSingleSpec(e,t){
  if(!t||"string"!==typeof t)return null;
  const r=t.trim();
  if(!r)return null;
  const i=e.sku_key||{
    
  }
  ,n=e.sku_key_list?.length?e.sku_key_list:Object.keys(i),s=this.cleanSkuMatchKey(r);
  for(const o of n){
    const e=i[o];
    if(!Array.isArray(e)||e.length<2)continue;
    const t=String(e[0]||"").trim(),n=String(e[1]||"").trim();
    if(!t||!n)continue;
    const a=[this.cleanSkuMatchKey(`${t} ${n}`),this.cleanSkuMatchKey(`${t}/${n}`),this.cleanSkuMatchKey(`${t}；${n}`),this.cleanSkuMatchKey(`${t},${n}`)].filter(Boolean);
    if(a.some((e=>e&&e===s)))return String(o);
    if(this.dimMatchSkuToSpec(t,r)&&this.dimMatchSkuToSpec(n,r))return String(o)
  }
  return null
}
_re