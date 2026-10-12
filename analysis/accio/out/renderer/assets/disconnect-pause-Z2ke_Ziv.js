var e=null;function r(){return e?.()??{ready:Promise.resolve(),release(){}}}function u(n){return e=n,()=>{e===n&&(e=null)}}export{u as n,r as t};
