// ==== sw_sendProxyRequestOnce_57433 @57433 ====
async function sendProxyRequestOnce(e){
  var r,t,a,s,o,n,i,c,l,d,u,m,h;
  pddHijackTrace("send_proxy_start",{
    body:summarizePddEditBody(null==e?void 0:e.data),hasCookieHeader:!(null==e||null===(r=e.headers)||void 0===r||!r.cookie),hasAntiContent:!(null==e||null===(t=e.headers)||void 0===t||!t["Anti-Content"]),hasOrigin:!!(null!=e&&null!==(a=e.headers)&&void 0!==a&&a.Origin||null!=e&&null!==(s=e.headers)&&void 0!==s&&s.origin),hasReferer:!!(null!=e&&null!==(o=e.headers)&&void 0!==o&&o.Referer||null!=e&&null!==(n=e.headers)&&void 0!==n&&n.referer),cookieLen:((null==e||null===(i=e.headers)||void 0===i?void 0:i.cookie)||"").length,antiLen:((null==e||null===(c=e.headers)||void 0===c?void 0:c["Anti-Content"])||"").length
  }
  );
  const g=await fetch("https://safe.koudai89.com/plugin/api/move/proxyRequest",{
    method:"POST",headers:{
      "Content-Type":"application/json"
    }
    ,body:JSON.stringify(e)
  }
  ),p=await g.json();
  return!0===(null==p||null===(l=p.data)||void 0===l?void 0:l.success)?(pddHijackTrace("send_proxy_ok",{
    httpStatus:g.status
  }
  ),{
    success:!0,status:g.status,result:p,via:"proxy"
  }
  ):(pddHijackTrace("send_proxy_fail",{
    httpStatus:g.status,error_msg:(null==p||null===(d=p.data)||void 0===d?void 0:d.error_msg)||(null==p||null===(u=p.data)||void 0===u?void 0:u.errorMsg)||"未知错误"
  }
  ),{
    success:!1,status:g.status,error_msg:(null==p||null===(m=p.data)||void 0===m?void 0:m.error_msg)||(null==p||null===(h=p.data)||void 0===h?void 0:h.errorMsg)||"未知错误",result:p,via:"proxy",isBizFailure:!0,errorCode:PDD_ERROR_CODE.API