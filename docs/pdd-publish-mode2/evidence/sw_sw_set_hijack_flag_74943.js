// ==== sw_set_hijack_flag_74943 @74943 ====
pdd_set_hijack_flag":return await handlePddSetHijackFlag(data,sender,request);
case"pdd_clear_hijack_flag":return await handlePddClearHijackFlag(sender);
case"pdd_hijack_trace_append":return await pddHijackTrace(request.step||(null==data?void 0:data.step)||"page_unknown",{
  from:"page",...request.data||data||{
    
  }
  
}
),{
  success:!0
}
;
case"inject_dependencies":return await handleInjectDependencies(sender);
case"check_injected":return handleCheckInjected(sender);
case"verify_dependencies":return await handleVerifyDependencies(sender);
case"inject_main_world":return await handleInjectMainWorld(request,sender);
case"sessionStorage":return await SessionStorageManager.handleMessage(request,sender,null);
case"chromeStorage":if("getAll"===request.action||"getAllKeys"===request.action||"clear"===request.action)return{
  success:!1,error:"不允许导出或清空存储"
}
;
if("get"===request.action&&isDumpStorageRead(request.key))return{
  success:!1,error:"不允许导出全部存储"
}
;
if("getMultiple"===request.action&&isDumpStorageRead(request.keys))return{
  success:!1,error:"不允许导出全部存储"
}
;
if("set"===request.action&&isProtectedStorageKey(request.key))return{
  success:!1,error:"不允许写入插件身份凭证"
}
;
if("setMultiple"===request.action){
  const e=stripProtectedStorageKeys(request.items);
  if(!e.items||0===Object.keys(e.items).length)return{
    success:!1,error:"不允许写入插件身份凭证"
  }
  ;
  request={
    ...request,items:e.items
  }
  
}
if("remove"===request.action){
  const e=filterStorageKeys(request.keys||request.key);
  if(0===e.allowed.length)return{
    success:!1,error:"不允许删除插件身份凭证"
  }
  ;
  request={
    ...request,keys:e.allowed,key:e.allowed[0]
  }
  
}
const{
  action:storageAction2,storageType:storageType="sync",key:storageKey,value:storageValue,defaultValue:storageDefault,items:storageItems,keys:storageKeys2
}
=request;
let storageResult;
const storage="local"===storageType?chrome.storage.local:chrome.storage.sync;
switch(storageAction2){
  case"set":storageResult=await new Promise(e=>{
    storage.set({
      [storageKey]:storageValue
    }
    ,()=>{
      chrome.runtime.lastError?e({
        success:!1,error:chrome.runtime.lastError.message
      }
      ):e({
        success:!0
      }
      )
    }
    )
  }
  );
  break;
  case"get":storageResult=await new Promise(e=>{
    storage.get([storageKey],r=>{
      if(chrome.runtime.lastError)e({
        success:!1,error:chrome.runtime.lastError.message
      }
      );
      else{
        const t=void 0!==r[