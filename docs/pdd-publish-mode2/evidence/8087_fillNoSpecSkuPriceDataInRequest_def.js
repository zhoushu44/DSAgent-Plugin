// ==== fillNoSpecSkuPriceDataInRequest_def @65538 ====
fillNoSpecSkuPriceDataInRequest(e,t,r,i){
  const n=this.resolveNoSpecPriceRecord(t);
  if(!n)return;
  const s=this.getPddStockMode(t),o=this.resolveNoSpecStock(t),a={
    ...n
  }
  ;
  2===s?a.stock=o:null!=n.stock&&""!==n.stock||(a.stock=o);
  let l=0,c=0,u=0;
  for(const d of r){
    if(d.spec&&d.spec.length>0)continue;
    const e=this.extractPrice(a),[r,n]=this.priceToFenAndYuan(e),p=this.computePddSingleBuyYuan(e,i),[h,m]=this.priceToFenAndYuan(p),f=this.resolveSkuStockForFill(t,a,o);
    d.multi_price=r,d.multi_price_in_yuan=n,d.price=h,d.price_in_yuan=m;
    const g=this.applyResolvedStockToCommitSku(d,f);
    this.logPddSkuStockDecision("fillSkuPriceData","无规格",a,f,o,s,g),l=Math.max(l,e),c=Math.max(c,p),u++
  }
  if(0===u&&r.length>0){
    const e=r[0],n=this.extractPrice(a),[u,d]=this.priceToFenAndYuan(n),p=this.computePddSingleBuyYuan(n,i),[h,m]=this.priceToFenAndYuan(p),f=this.resolveSkuStockForFill(t,a,o);
    e.multi_price=u,e.multi_price_in_yuan=d,e.price=h,e.price_in_yuan=m;
    const g=this.applyResolvedStockToCommitSku(e,f);
    this.logPddSkuStockDecision("fillSkuPriceData","无规格首行兜底",a,f,o,s,g),l=Math.max(l,n),c=Math.max(c,p)
  }
  this.applyPddMarketReferencePrice(e,l,c,"fillNoSpecSkuPriceDataInRequest")
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
  return!(!1===t||"false"===t||0===t||"0"===t)
}
preprocessTitleByMoveConfig(e,t={
  
}
){
  return b(e,t)
}
async devWaitGoodsDetailPageReady(){
  return p()
}
async fillShipmentDeliveryTimeIfNeeded(e){
  return h(this,e)
}
async startFill(e,t){
  try{
    window.onbeforeunload=null;
    const e=document.createElement("script");
    e.textContent="(function(){ window.onbeforeunload = null; })()",document.body.appendChild(e),e.remove()
  }
  catch(r){
    
  }
  setTimeout((()=>{
    try{
      window.onbeforeunload=null;
      const e=document.createElement("script");
      e.textContent="(function(){ window.onbeforeunload = null; })()",document.body.appendChild(e),e.remove()
    }
    catch(r){
      
    }
    
  }
  ),3e3),await this.startMoveTimer(e),e.imageStorage&&(this.imageFolderId=e.imageStorage),this.uploadedCount=0,this.uploadRetryCount=0;
  try{
    await this.withMoveTimerStep(e,"wait_page",(()=>this.devWaitGoodsDetailPageReady())),e.pdd_move_cateName=document.querySelector("#goods-category .sort-name ")?.innerText||"",e.move_platform_cateName=document.querySelector("#goods-category .sort-name ")?.innerText||"";
    let t=!1;
    const r=e.video_url&&e.video_radio;
    if(r?await this.withMoveTimerStep(e,"main_video",(async()=>{
      this.updateWorkingText("正在上传主图视频"),this.uploadVideoPromise=await this.uploadMainVideo(e).then((()=>{
        t=!0,this.addSuccessStep("主图视频上传")
      }
      )).catch((t=>{
        e.video_upload={
          video_name:"error",check_comment:t.message
        }
        ,this.addErrorStep("主图视频上传",t.message,!1)
      }
      ))
    }
    )):this.skipMoveTimerStep(e,"main_video"),this.updateWorkingText("正在上传图片"),await this.withMoveTimerStep(e,"image_upload",(async()=>{
      try{
        await this.uploadAllImages(e),this.addSuccessStep("图片上传")
      }
      catch(t){
        this.addErrorStep("图片上传",t.message,!1)
      }
      
    }
    )),this.updateWorkingText("正在填充标题及属性"),await this.withMoveTimerStep(e,"title_attr",(async()=>{
      try{
        await this.fillTitleAndAttributes(e),this.addSuccessStep("填充标题及属性")
      }
      catch(t){
        this.addErrorStep(