// ==== anti_generator_def @5324 ====
async function _(){
  try{
    const e=await(0,s.gT)();
    return e||""
  }
  catch(e){
    return""
  }
  
}
function y(e){
  if(1===e||"1"===e)return 1;
  if(2===e||"2"===e)return 2;
  const t=Number(e);
  return 1===t?1:2
}
function b(e,t={
  
}
){
  let r=e||"";
  if(!r)return"标题读取失败，请检查商品标题";
  const i=(t.title_filter_words||"").trim();
  if(i){
    const e=i.split(/\s+/).filter(Boolean);
    for(const t of e)r=r.split(t).join("");
    r=r.trim()
  }
  const n=(t.title_prefix||"").trim(),s=(t.title_suffix||"").trim();
  return(n||s)&&(r=`${n}${r}${s}`),r
}
class S extends n.Ay{
  static getOrCreate(){
    if("undefined"!==typeof window&&window.__PDD_PUBLISHER_INSTANCE&&"function"===typeof window.__PDD_PUBLISHER_INSTANCE.setupMessageListener)return window.__PDD_PUBLISHER_INSTANCE;
    const e=new S;
    return"undefined"!==typeof window&&(window.__PDD_PUBLISHER_INSTANCE=e),e
  }
  constructor(){
    if(super("pinduoduo"),"undefined"!==typeof window&&window.__PDD_PUBLISHER_INSTANCE&&window.__PDD_PUBLISHER_INSTANCE!==this&&"function"===typeof window.__PDD_PUBLISHER_INSTANCE.setupMessageListener)return window.__PDD_PUBLISHER_INSTANCE;
    this.platform="pinduoduo",this.displayName="拼多多商家版",this.platformName="拼多多",this.supportedDomains=["mms.pinduoduo.com"],this.publishUrls=["https://mms.pinduoduo.com/goods/category","https://mms.pinduoduo.com/goods/goods_add/index","https://mms.pinduoduo.com/goods/goods_add/success"],this.setupMessageListener(),"undefined"!==typeof window&&(window.__PDD_PUBLISHER_INSTANCE=this)
  }
  _pddTryClaimMessageId(e,t=""){
    return!e||("undefined"===typeof window||(window.__PDD_MSG_INFLIGHT||(window.__PDD_MSG_INFLIGHT=new Set),window.__PDD_MSG_INFLIGHT.has(e)?(this._pddHijackP