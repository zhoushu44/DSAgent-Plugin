// ==== sw_shouldUseProxyFallback_61112 @61112 ====
function shouldUseProxyFallback(e){
  if(!e||e.success)return!1;
  if(e.networkError||e.authOrEnvError)return!0;
  const r=Number(e.status);
  return 401===r||403===r||r>=500||e.errorCode===PDD_ERROR_CODE.SEND_NETWORK||e.errorCode===PDD_ERROR_CODE.PROXY_FALLBACK_FAIL||!e.isBizFailure&&e.errorCode!==PDD_ERROR_CODE.API_BIZ
}
async function updateGoodsDetailInLocalStorage(e,r){
  let t=!1,a=!1;
  try{
    var s;
    const o=JSON.stringify(r),n=btoa(unescape(encodeURIComponent(o))),i=await chrome.scripting.executeScript({
      target: