// ==== findPriceDataForMultiDimensionalSku_def @259079 ====
findPriceDataForMultiDimensionalSku(a,l,s,n);
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
  k=Math.max(k,e),v=