// ==== transformRequestBody_def @255805 len=6000 (module m_042_8087.js) ====
transformRequestBody(e,t){
  const r=this._pddSummarizeEditBody(e);
  if(t){
    (t.gallery||[]).filter((e=>1===e?.type)).length,(t.gallery||[]).filter((e=>2===e?.type)).length
  }
  else;
  this._pddHijackPageTrace("transformRequestBody_start",{
    before:r,hasGoodsDetail:!!t,goodsType1:(t?.gallery||[]).filter((e=>1===e?.type)).length,goodsType2:(t?.gallery||[]).filter((e=>2===e?.type)).length,skuPriceKeys:t?.price_detail?Object.keys(t.price_detail).length:0
  }
  ),this.fillImageData(e,t),this.fillSkuPriceData(e,t),this.fillShippingConfig(e,t),this.applyPddElecGoodsAttributes(e);
  const i=this._pddSummarizeEditBody(e);
  return this._pddHijackPageTrace("transformRequestBody_done",{
    before:r,after:i,type1Delta:(i.type1||0)-(r.type1||0),skusPricedDelta:(i.skusPriced||0)-(r.skusPriced||0)
  }
  ),localStorage.setItem("kdds_pdd_requestBody",JSON.stringify(e)),e
}
fillImageData(e,t){
  if(t){
    if(t.gallery&&t.gallery.length>0){
      (e.gallery||[]).filter((e=>1===e?.type)).length,(e.gallery||[]).filter((e=>2===e?.type)).length,(t.gallery||[]).filter((e=>1===e?.type)).length,(t.gallery||[]).filter((e=>2===e?.type)).length;
      e.gallery=t.gallery
    }
    if(t.floor_list&&t.floor_list.length>0&&(e.decorationDetail=t.floor_list),t.preview_url&&(e.decorationPreview=t.preview_url),t.video_upload&&"通过"===t?.video_upload?.check_comment){
      let r=[];
      r.push(t.video_upload);
      let i=e.gallery,n={
        file_id:t.video_upload.id,height:t.video_upload?.extra_info.height,type:6,url:t.video_upload?.extra_info?.video_cover_url,video_url:t.video_upload.url,width:t.video_upload?.extra_info.width
      }
      ;
      i.push(n),e.gallery=i,e.carousel_video=r
    }
    
  }
  
}
fillSkuPriceData(e,t){
  const r=e.skus,i=t.price_detail,n=(t.upload_img_list||t.img_all_list,t.sku_sort||[]),s=t.movingConfig||{
    
  }
  ,o={
    pdd_single_buy_rule_type:s.pdd_single_buy_rule_type??t.pdd_single_buy_rule_type,pdd_single_buy_percent:s.pdd_single_buy_percent??t.pdd_single_buy_percent,pdd_single_buy_fixed_yuan:s.pdd_single_buy_fixed_yuan??t.pdd_single_buy_fixed_yuan
  }
  ,a=t.sku_price||{
    
  }
  ,l=t.sku_key||{
    
  }
  ,c=n.length>2,u=!c&&Object.keys(l).length>0?this.buildStablePriceDetailForFill(t):null;
  let d=null;
  c||(u&&!this.isEmptyPriceDetailTable(u)?d=u:i&&!this.isEmptyPriceDetailTable(i)&&(d=i));
  const p=this.getPddStockMode(t);
  let h;
  if(2===p)h=this.getPddCustomInventory(t);
  else{
    const e=null!=s.inventory&&""!==s.inventory?s.inventory:t.inventory;
    if(null!=e&&""!==e){
      const t=parseInt(String(e),10);
      h=isNaN(t)?999:t
    }
    else h=999
  }
  if(!r)return;
  if(e.out_goods_sn=this.resolveSafePddOutGoodsSn(t,s),0===n.length)return void this.fillNoSpecSkuPriceDataInRequest(e,t,r,o);
  if(c&&0===Object.keys(a).length)return;
  const m=!c&&Object.keys(a).length>0&&Object.keys(l).length>0;
  if(!c&&!d&&!m)return;
  const f=this.resolveSingleSkuPriceFallback(t),g=r.filter((e=>e.spec&&e.spec.length>0)),_=g.length>0&&g.every((e=>this.specTextsLookLikeRowCodePlaceholders(this.collectSpecTextsFromPddSku(e)))),y=!c&&m?this.getOrderedSkuKeyIdsWithPrice(t):[],b=!c&&m&&_&&y.length>0&&y.length===g.length;
  let S=0;
  const w={
    perSpec1:new Map
  }
  ;
  let k=0,v=0;
  const C={
    total:0,ok:0,miss:0,skuIdKeys:new Set,thumbUrls:new Set,via:{
      
    }
    ,missSamples:[]
  }
  ;
  for(const x of r){
    if(!x.spec||0===x.spec.length)continue;
    const e=this.collectSpecTextsFromPddSku(x),r=e[0]||"",i=e[1]||"",s=e,u=this.cleanSpecName(r),g=this.cleanSpecName(i);
    let _=null,I=null;
    if(c){
      const e=this.findPriceDataForMultiDimensionalSku(a,l,s,n);
      e&&(_=e.priceData,I=e.matchedKey)
    }
    else if(b){
      const e=y[S++];
      _=this.normalizeSkuPriceRecord(a[e])
    }
    else{
      const o=Object.keys(l)[0],a=o?l[o]:null,c=Array.isArray(a)&&a.length>=2,p=1===e.filter(Boolean).length&&c;
      p&&e[0]&&(_=this.findTwoDimPriceByCombinedSingleSpec(t,e[0])),!_&&p&&e[0]&&(_=this.findTwoDimPriceByFirstDimOrdinal(t,e[0],w)),_||(_=this.findPriceDataByPublishedSpec(t,s)),_||(_=this.findPriceDataForSkuFuzzy(d||{
        
      }
      ,r,i,u,g,n)),!_&&m&&s.filter(Boolean).length>=2&&c&&(_=this.findTwoDimPriceFromSkuMatrixUnordered(t,s)),!_&&f&&(_=f.priceData)
    }
    if(_){
      const e=this.extractPrice(_),[r,i]=this.priceToFenAndYuan(e),n=this.computePddSingleBuyYuan(e,o),[a,l]=this.priceToFenAndYuan(n);
      x.multi_price=r,x.multi_price_in_yuan=i,x.price=a,x.price_in_yuan=l;
      const c=this.resolveSkuStockForFill(t,_,h),u=this.applyResolvedStockToCommitSku(x,c);
      k=Math.max(k,e),v=Math.max(v,n);
      const d=s.join("/");
      this.logPddSkuStockDecision("fillSkuPriceData",d,_,c,h,p,u)
    }
    else{
      x.is_onsale=0,delete x.quantity,x.quantity_delta=0,x.multi_price=0,x.multi_price_in_yuan="0",x.price=0,x.price_in_yuan="0";
      s.join("/")
    }
    const A=this._applyPddSkuThumbUrlToCommitSku(t,x,s);
    C.total+=1,A?.ok&&A.thumbUrl?(C.ok+=1,C.skuIdKeys.add(String(A.skuIdKey||"")),C.thumbUrls.add(String(A.thumbUrl)),A.matchVia&&(C.via[A.matchVia]=(C.via[A.matchVia]||0)+1)):(C.miss+=1,C.missSamples.length<8&&C.missSamples.push({
      spec:(s||[]).join("/").slice(0,80),reason:A?.missReason||"unknown",matchVia:A?.matchVia||""
    }
    ))
  }
  this.applyPddMarketReferencePrice(e,k,v,"fillSkuPriceData"),C.skuIdKeys.delete(""),C.ok>0&&C.uniqueSkuIdKeys>0&&C.uniqueSkuIdKeys<Math.min(C.ok,20)&&C.ok
}
cleanSpecName(e){
  if(!e)return"";
  const t=String(e).trim(),r=this.sanitizePddSpecWhitelist(t);
  return r?r.length<=S.PDD_SPEC_MAX_JS_LEN?r:this.canonicalizePddSpecValue(r):""
}
_resolvePddSkuIdKeyForCommitSku(e,t){
  return this._resolvePddSkuIdKeyForThumb(e,t).skuIdKey||null
}
findPriceDataByPublishedSpec(e,t){
  const r=(t||[]).map((e=>String(e||"").trim())).filter(Boolean);
  if(!r.length)return null;
  const i=e.sku_key||{
    
  }
  ,n=e.sku_price||{
    
  }
  ,s=e.pdd_published_spec_by_sku_id||{
    
  }
  ,o=e.sku_key_list?.length?e.sku_key_list:Object.keys(i);
  for(const a of o){
    const e=s[a],t=i[a],o=Array.isArray(e)&&e.length?e:Array.isArray(t)?t:[];
    if(!o.length)continue;
    let l=!0;
    for(let i=0;
    i<r.length;
    i++){
      const e=r[i],t=null!=o[i]?String(o[i]).trim():"",n=this.sanitizePddSpecWhitelist(e);
      if(t!==e&&t!==n&&this.sanitizePddSpecWhitelist(t)!==n){
        l=!1;
        break
      }
      
    }
    if(l){
      const e=this.normalizeSkuPriceRecord(n[a]);
      if(e)return e
    }
    
  }
  return null
}
resolveSingleSkuPriceFallback(e){
  const t=e.sku_key||{
    
  }
  ,r=e.sku_price||{
    
  }
  ,i=e.sku_key_list?.length?e.sku_key_list:Object.keys(t),n=i.filter((e=>this.normalizeSkuPrice