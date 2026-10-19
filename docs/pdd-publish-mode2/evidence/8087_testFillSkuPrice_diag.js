// ==== testFillSkuPrice_diag @4552 len=900 (module m_042_8087.js) ====
kdds_pdd_requestBody");
if(!e||!e.trim())throw new Error("localStorage 无 kdds_pdd_requestBody：请先在发布页触发含 skus 的保存/校验请求（或任一写入该键的流程）");
let t;
try{
  t=JSON.parse(e)
}
catch(s){
  throw new Error(`kdds_pdd_requestBody 非合法 JSON：${s.message}`)
}
if(!t.skus||!Array.isArray(t.skus)||0===t.skus.length)throw new Error("requestBody.skus 为空：当前缓存的请求体不适用填价测试");
const r=JSON.parse(JSON.stringify(t));
i.fillSkuPriceData(r,n);
try{
  localStorage.setItem("kdds_pdd_requestBody",JSON.stringify(r))
}
catch(o){
  
}
(r.skus||[]).slice(0,3).map((e=>({
  spec:e.spec,price:e.price,multi_price:e.multi_price,quantity:e.quantity,quantity_delta:e.quantity_delta
}
)))
}
,startFillFull:()=>i.startFill(n,s)
}
,a=o[e];
if(!a)throw new Error("未知步骤: "+e);
return await a(),{
  step:e,productId:n.productId||n.goods_id
}

}
)
}
var g=r(9820);
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
  if(2===e