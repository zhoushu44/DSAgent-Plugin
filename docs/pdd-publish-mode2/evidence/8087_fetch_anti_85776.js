// ==== fetch_anti_85776 @85776 ====
fetch("https://mms.pinduoduo.com/galerie/business/get_signature",{
  method:"POST",headers:{
    "Content-Type":"application/json","Anti-Content":e
  }
  ,body:JSON.stringify({
    bucket_tag:"mms-material-img"
  }
  )
}
),r=await t.json();
return r.result.signature
}
_stripPddImageExt(e){
  return String(null==e?"":e).replace(/\.(jpg|jpeg|png|gif|webp)$/i,"")
}
_resolvePddImageSourceUrl(e){
  return null==e||""===e?"":"string"===typeof e?e:"object"===typeof e&&e.url?String(e.url):""
}
_cleanPddImageUrl(e){
  return e=String(null==e?"":e),e=e.replace("_.webp","").replace(".avif",""),e.startsWith("//")?e="https:"+e:e.startsWith("http:")?e=e.replace("http:","https:"):e&&!e.startsWith("https://")&&(e="https://"+e),e
}
_computePddAdaptiveI