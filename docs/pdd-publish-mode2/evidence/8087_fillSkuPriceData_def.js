// ==== fillSkuPriceData_def @257371 ====
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
      k=Math.max