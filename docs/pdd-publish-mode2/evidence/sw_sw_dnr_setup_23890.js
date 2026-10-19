// ==== sw_dnr_setup_23890 @23890 ====
chrome.declarativeNetRequest.getDynamicRules();
if(e.length>0){
  const r=e.map(e=>e.id);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds:r
  }
  )
}
const r=await chrome.storage.local.get(this.storageKey);
if(r[this.storageKey]){
  const e=JSON.parse(r[this.storageKey]);
  for(const r of e)await this.addInterceptor(r,!1)
}
this.initialized=!0
}
catch(e){
  console.error("[拦截器管理器] 初始化失败:",e),this.initialized=!0
}

}
async ensureInitialized(){
  this.initialized||await this.initPromise
}
async saveToStorage(){
  try{
    const e=Array.from(this.interceptors.values());
    await chrome.storage.local.set({
      [this.storageKey]:JSON.stringify(e)
    }
    )
  }
  catch(e){
    console.error("[拦截器管理器] 保存到存储失败:",e)
  }
  
}
async addInterceptor(e,r=!0){
  const{
    id:t,urlPattern:a,headers:s,enabled:o=!0
  }
  =e;
  if(!t||!a||!s)return console.error("[拦截器管理器] 参数不完整:",e),{
    success:!1,error:"参数不完整"
  }
  ;
  try{
    this.interceptors.has(t)&&await this.removeInterceptor(t,!1);
    const e=this.ruleIdCounter++;
    return this.interceptors.set(t,{
      id:t,urlPattern:a,headers:s,enabled:o,ruleId:e
    }
    ),o&&await this._addRule(t,e,a,s),r&&await this.saveToStorage(),{
      success:!0,id:t
    }
    
  }
  catch(e){
    return console.error(`[拦截器管理器] ❌ 添加拦截器失败: ${t}`,e),{
      success:!1,error:e.message
    }
    
  }
  
}
async _addRule(e,r,t,a){
  const s=[];
  for(const[e,r]of Object.entries(a))s.push({
    header:e,operation:"set",value:r
  }
  );
  const o={
    id:r,priority:1,action:{
      type:"modifyHeaders",requestHeaders:s
    }
    ,condition:{
      urlFilter:t.includes("://")?t:`*${t}*`,resourceTypes:["main_frame","sub_frame","stylesheet","script","image","font","object","xmlhttprequest","ping","csp_report","media","websocket","webtransport","webbundle","other"]
    }
    
  }
  ;
  try{
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules:[o]
    }
    )
  }
  catch(r){
    throw console.error(`[拦截器管理器] ❌ 规则添加失败: ${e}`,r),r
  }
  
}
async removeInterceptor(e,r=!0){
  if(!this.interceptors.has(e))return{
    success:!1,error:"拦截器不存在"
  }
  ;
  try{
    const t=this.interceptors.get(e);
    return t.ruleId&&await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds:[t.ruleId]
    }
    ),this.interceptors.delete(e),r&&await this.saveToStorage(),{
      success:!0,id:e
    }
    
  }
  catch(r){
    return console.error(`[拦截器管理器] ❌ 移除拦截器失败: ${e}`,r),{
      success:!1,error:r.message
    }
    
  }
  
}
async updateInterceptor(e,r){
  if(!this.interceptors.has(e))return{
    success:!1,error:"拦截器不存在"
  }
  ;
  const t={
    ...this.interceptors.get(e),...r
  }
  ;
  return await this.addInterceptor(t)
}
async toggleInterceptor(e,r){
  return await this.updateInterceptor(e,{
    enabled:r
  }
  )
}
listInterceptors(){
  return Array.from(this.interceptors.values())
}
hasInterceptor(e){
  return this.interceptors.has(e)
}
async clearAll(){
  try{
    const e=[];
    for(const r of this.interceptors.values())r.ruleId&&e.push(r.ruleId);
    return e.length>0&&await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds:e
    }
    ),this.interceptors.clear(),await chrome.storage.local.remove(this.storageKey),{
      success:!0
    }
    
  }
  catch(e){
    return console.error