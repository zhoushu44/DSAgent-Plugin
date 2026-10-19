// ==== fetch_anti_105443 @105443 ====
fetch("https://mms.pinduoduo.com/gorse/mms/goods/decoration/commit/save",{
  method:"POST",headers:{
    "Content-Type":"application/json","Anti-Content":t
  }
  ,body:JSON.stringify({
    goods_commit_id:r,goods_id:i,decoration_floor_list:e
  }
  )
}
),s=await n.json(),o=s.result;
return o
}
async queryDecorationFloor(){
  const e=await _(),t=location.href.match(/[?&]id=(\d+)/)?.[1],r=location.href.match(/[?&]goods_id=(\d+)/)?.[1],i=await fetch("https://mms.pinduoduo.com/gorse/mms/goods/decoration/commit/query/V2",{
    method:"POST",headers:{
      "Content-Type":"application/json","Anti-Content":e
    }
    ,body:JSON.stringify({
      goods_commit_id:t,goods_id:r
    }
    )
  }
  ),n=await i.json(),s=n.result?.floor_list;
  return s
}
async getDecorationPreview(){
  const e=await _(),t=location.href.match(/[?&]id=(\d+)/)?.[1],r=location.href.match(/[?&]goods_id=(\d+)/)?.[1],i=await fetch("https://mms.pinduoduo.com/gorse/mms/goods/decoration/preview",{
    method:"POST",headers:{
      "Content-Type":"application/json","Cache-Control":" max-age=0","Anti-Content":e
    }
    ,body:JSON.stringify({
      goods_commit_id:t,goods_id:r
    }
    )
  }
  ),n=await i.json();
  return n.result?.preview_url
}
async processVideoAspectRatio(e){
  return new Promise(((t,r)=>{
    let i=!1;
    try{
      const r=document.createElement("video"),n=URL.createObjectURL(e);
      r.src=n,r.muted=!0,r.preload="metadata";
      const s=setTimeout((()=>{
        i||(i=!0,URL.revokeObjectURL(n),t(e))
      }
      ),5e3);
      r.onloadedmetadata=()=>{
        if(!i)try{
          const o=r.videoWidth,a=r.videoHeight,l=o/a,c=16/9;
          if(i=!0,clearTimeout(s),URL.revokeObjectURL(n),Math.abs(l-c)<.05)return void t(e);
          t(e)
        }
        catch(o){
          i||(i=!0,clearTimeout(s),URL.revokeObjectURL(n),t(e))
        }
        
      }
      ,r.onerror=r=>{
        i||(i=!0,clearTimeout(s),URL.revokeObjectURL(n),t(e))
      }
      
    }
    catch(n){
      i||(i=!0,t(e))
    }
    
  }
  ))
}
async selectMainVideo(e){
  try{
    const t=await _();
    let r={
      if_query_dir:!0,order_by:"create_time desc",dir_id:0,page:1,page_size:10,fil