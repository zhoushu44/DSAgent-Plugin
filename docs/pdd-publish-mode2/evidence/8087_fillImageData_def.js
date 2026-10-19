// ==== fillImageData_def @256635 ====
fillImageData(e,t){
  if(t){
    if(t.gallery&&t.gallery.length>0){
      (e.gallery||[]).filter((e=>1===e?.type)).length,(e.gallery||[]).filter((e=>2===e?.type)).length,(t.gallery||[]).filter((e=>1===e?.type)).length,(t.gallery||[]).filter((e=>2===e?.type)).length;
      e.gallery=t.gallery
    }
    if(t.floor_list&&t.floor_list.length>0&&(e.decorationDetail=t.floor_list),t.preview_url&&(e.decorationPreview=t.preview_url),t.video_upload&&"通过"===t?.video_upload?.check_comment){
      let r=[];
      r.push(t.video_upload);
      let i=e.gallery,n={
        file_id:t.video_upload.id,height:t.video_upload?.extra_info.height,type:6,url:t.video_upload?.extra_info?.video_cover_url,video_url:t.video_upload.url,width:t.video_upload?.extra_info.width
      }
      ;
      i.push(