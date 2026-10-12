import{s as He}from"./rolldown-runtime-BSJ3dJRS.js";import{a as Oe,i as ze}from"./vendor-react-BflrOYNF.js";import{i as Be,r as Re}from"./vendor-i18n-udtrfyWc.js";import{F as Me,I as $e,L as je,N as Ue,P as We,Tt as Fe,wt as ke}from"./vendor-ui-BcaUJBsv.js";import{Ga as ue,Ja as Ve,Ka as Ge,Ua as qe,Wa as Ke,pr as Ye,qa as De,vr as te}from"./index-B3kRscgu.js";import{C as Pe,Lt as Xe,Mt as Je,Nt as ge,Vt as R,kt as Ze,w as Ne}from"./gateway-client-BZvNv_1t.js";import{n as Qe,r as en}from"./platform-zuIjaMu9.js";import{Jl as nn,_u as tn,a as Z,ap as rn,cp as on,eu as an,hu as sn,i as ln,mu as cn,uu as dn,vp as pn}from"./app-store-Ckqd27Cr.js";import{b as un,d as gn,n as hn}from"./file-upload-ljvyVPjH.js";import{n as mn}from"./vendor-sanitize-ZqtdjMRs.js";import{n as fn,t as yn}from"./toast-QkYvegOn.js";import{r as xn,t as vn}from"./iframe-anchor-nav-DtfhSthP.js";import{a as bn,i as Ae,n as _e,o as wn,r as Tn,t as En}from"./filemap-oss-B-9IIKUg.js";var Sn=`/**
 * Editor CSS - 1:1 复刻 page-editor/style.css
 */

/* ===== 设计令牌 ===== */
:root {
  --text-primary: #34322d;
  --text-secondary: #5e5e5b;
  --text-tertiary: #858481;
  --text-disable: #b9b9b7;
  --text-blue: #0081f2;
  --text-white: #ffffff;
  --text-white-tsp: #ffffff99;
  --background-gray-main: #f8f8f7;
  --background-white-main: #ffffff;
  --background-canvas-bg: #f0f0ef;
  --border-main: #0000000f;
  --border-dark: #0000001f;
  --icon-primary: #34322d;
  --icon-secondary: #5e5e5b;
  --icon-tertiary: #858481;
  --icon-disable: #b9b9b7;
  --Button-primary-brand: #0081f2;
  --fill-tsp-white-main: #37352f0f;
  --shadow-S: #00000014;
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

/* ===== Canvas 高亮覆盖层 ===== */
#hlCanvas {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 2147483646;
  pointer-events: none;
}

/* ===== 底部 EditToolbar（逆向自 EditToolbar.tsx） ===== */
.etb-wrap {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  pointer-events: none;
  z-index: 2147483645;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 24px;
  transition:
    opacity 0.25s,
    transform 0.25s;
}

.etb-wrap.hidden {
  opacity: 0;
  transform: translateY(16px);
  pointer-events: none;
}

.etb {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 8px 12px;
  border-radius: 14px;
  border: 1px solid var(--border-main);
  background: rgb(37, 37, 37);
  box-shadow: 0 8px 32px var(--shadow-S);
  position: relative;
}

.badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.12s;
  color: var(--text-white);
  border: 1.5px solid var(--text-tertiary);
  background: none;
  font-family: var(--font);
}

.badge:hover {
  background: #ffffff0f;
}

.badge svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: block;
}

.badge-n {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.ur {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ur-b {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  color: var(--text-white);
  background: none;
  transition: background 0.12s;
}

.ur-b:hover {
  background: #ffffff0f;
}

.ur-b:disabled {
  color: var(--text-disable);
  opacity: 0.5;
  cursor: not-allowed;
}

.ur-b:disabled:hover {
  background: none;
}

.ur-b svg {
  width: 16px;
  height: 16px;
}

.ab {
  display: flex;
  align-items: center;
  gap: 8px;
}

.b-dis {
  padding: 6px 12px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-white);
  border: 1.5px solid var(--text-tertiary);
  background: none;
  cursor: pointer;
  font-family: var(--font);
  transition: background 0.12s;
}

.b-dis:hover {
  background: #ffffff0f;
}

.b-dis:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.b-app {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  background: #555;
  border: none;
  cursor: pointer;
  font-family: var(--font);
  transition: opacity 0.12s;
  position: relative;
}

.b-app:not(:disabled) {
  background: #00b578;
}

/* JS 在 updateETB() 里 add/remove .wave，绕过浏览器伪类动画兼容问题 */
.b-app.wave {
  background: linear-gradient(
    135deg,
    #00ffb0,
    #00d68f,
    #00ff9d,
    #00b578,
    #5fffd4,
    #00d68f,
    #00ff9d,
    #00b578
  );
  background-size: 400% 400%;
  animation: wave-animation 3s ease-in-out infinite;
}

.b-app:hover:not(:disabled) {
  opacity: 0.9;
}

@keyframes wave-animation {
  0% {
    background-position: 0% 50%;
  }

  25% {
    background-position: 50% 100%;
  }

  50% {
    background-position: 100% 50%;
  }

  75% {
    background-position: 50% 0%;
  }

  100% {
    background-position: 0% 50%;
  }
}

.b-app:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ===== EditCards（逆向自 EditPreviewCards.tsx） ===== */
.ecards {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  right: 0;
  border-radius: 14px;
  border: 1px solid var(--border-main);
  background: rgb(37, 37, 37);
  box-shadow: 0 8px 32px var(--shadow-S);
  max-height: 40vh;
  overflow-y: auto;
  transition:
    opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  overscroll-behavior: contain;
}

.ecards.hidden {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
  pointer-events: none;
}

.ecard {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  cursor: pointer;
  transition: background 0.12s;
  border-bottom: 1px solid var(--icon-secondary);
}

.ecard:last-child {
  border-bottom: none;
}

.ecard:hover,
.ecard.hv {
  background: #ffffff0f;
}

.ecard-n {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--icon-secondary);
  color: #fafafa;
  font-size: 11px;
  flex-shrink: 0;
}

.ecard-i {
  flex: 1;
  min-width: 0;
}

.ecard-t {
  font-size: 13px;
  font-weight: 500;
  color: #fff;
}

.ecard-t.del {
  text-decoration: line-through;
}

.ecard-d {
  font-size: 11px;
  color: var(--text-white-tsp);
  margin-top: 2px;
  line-height: 1.3;
}

/* ===== SelectorInput 全屏容器（逆向自 ControlPanel.tsx:1005） ===== */
.si-overlay {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 2147483647;
}

/* ===== SelectorInput 面板容器（1:1 逆向自 ControlPanel.tsx 外层 div） ===== */
.si-panel {
  position: absolute;
  pointer-events: auto;
  border-radius: 20px;
  border: 1px solid var(--border-main);
  overflow: hidden;
  background: var(--background-gray-main);
  box-shadow: 0 8px 32px 0 var(--shadow-S);
  width: 320px;
  max-height: 80vh;
  font-family: var(--font);
  display: flex;
  flex-direction: column;
  transition:
    opacity 0.2s,
    transform 0.2s;
  overscroll-behavior: contain;
}

.si-panel.hidden {
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
  transform: scale(0.95);
}

/* ===== 头部区域（ControlPanel.tsx:1025） ===== */
/* ===== 面板头部操作区 - 重新设计 ===== */
.si-header-wrap {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  position: relative;
}

/* Comment 输入行 */
.si-comment-row {
  display: flex;
  align-items: center;
  margin: 0;
  padding: 12px 16px;
  gap: 10px;
  border-bottom: 1px solid var(--border-main);
  background: var(--background-white-main);
  border-radius: 16px 16px 0 0;
}

/* Comment 容器 - 简化样式 */
.si-comment-wrap {
  flex: 1;
  position: relative;
  border-radius: 6px;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
}

.si-comment-wrap:focus-within {
  box-shadow: 0 0 0 2px rgba(0, 129, 242, 0.15);
}

/* Comment textarea */
.si-comment {
  width: 100%;
  font-size: 14px;
  line-height: 20px;
  height: 32px;
  min-height: 32px;
  max-height: 32px;
  padding: 6px 12px;
  background: var(--background-gray-main);
  color: var(--text-primary);
  border: 1px solid var(--border-main);
  border-radius: 6px;
  resize: none;
  overflow-y: auto;
  font-family: var(--font);
  outline: none;
  transition:
    border-color 0.15s,
    background 0.15s;
  box-sizing: border-box;
  overscroll-behavior: contain;
  vertical-align: middle;
}

.si-comment:focus {
  background: var(--background-white-main);
  border-color: var(--text-blue);
}

.si-comment::placeholder {
  color: var(--text-disable);
}

/* 面板操作按钮组 - 统一设计 */
.si-panel-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex-shrink: 0;
}

/* 关闭按钮 - 次要操作，低调 */
.si-close-btn {
  position: relative;
  top: auto;
  right: auto;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  color: var(--icon-secondary);
  background: transparent;
  transition: all 0.2s ease;
  outline: none;
}

.si-close-btn:hover {
  color: var(--icon-primary);
  background: var(--background-gray-light);
  border-color: var(--border-light);
}

.si-close-btn:active {
  transform: scale(0.95);
  background: var(--background-gray-main);
}

/* 确认按钮 - 主要操作，醒目 */
.si-confirm-btn {
  position: relative;
  top: auto;
  right: auto;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  height: 32px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  color: #ffffff;
  background: linear-gradient(135deg, #1eab6f 0%, #16a085 100%);
  font-size: 13px;
  font-weight: 600;
  font-family: var(--font);
  transition: all 0.2s ease;
  outline: none;
  box-shadow: 0 2px 6px rgba(30, 173, 111, 0.25);
}

.si-confirm-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #1db96e 0%, #18b090 100%);
  box-shadow: 0 4px 12px rgba(30, 173, 111, 0.35);
  transform: translateY(-1px);
}

.si-confirm-btn:active:not(:disabled) {
  transform: translateY(0) scale(0.98);
  box-shadow: 0 1px 3px rgba(30, 173, 111, 0.2);
}

.si-confirm-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: var(--background-gray-main);
  color: var(--text-tertiary);
  box-shadow: none;
}

/* ===== 内容编辑区（ControlPanel.tsx:1116-1160） ===== */
.si-content-area {
  padding: 0 10px;
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.si-content-area.hidden {
  display: none;
}

.si-field-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.si-field-label {
  font-size: 12px;
  color: var(--text-tertiary);
  padding: 0 2px;
}

.si-field-input {
  width: 100%;
  font-size: 14px;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: var(--fill-tsp-white-main);
  color: var(--text-primary);
  font-family: var(--font);
  outline: none;
  transition: all 0.15s;
}

.si-field-input:focus {
  box-shadow: inset 0 0 0 1px var(--border-dark);
}

.si-field-input::placeholder {
  color: var(--text-disable);
}

.si-field-textarea {
  height: 32px;
  min-height: 32px;
  max-height: 112px;
  resize: none;
  overflow-y: hidden;
  line-height: 20px;
  overscroll-behavior: contain;
}

/* ===== Tab 栏（ControlPanel.tsx:1173-1199） ===== */
.si-tabs {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 4px 8px 0;
  flex-shrink: 0;
}

.si-tab {
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 400;
  color: var(--text-tertiary);
  border: none;
  background: none;
  cursor: pointer;
  font-family: var(--font);
  position: relative;
  transition: all 0.15s;
  outline: none;
}

.si-tab:hover {
  color: var(--text-secondary);
}

.si-tab:focus {
  color: var(--text-secondary);
}

.si-tab:active {
  opacity: 0.8;
}

.si-tab.active {
  color: var(--text-primary);
}

.si-tab.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--text-primary);
  border-radius: 9999px;
}

/* ===== Tab 内容区: translateX 交叉滑动 ===== */
.si-body-wrap {
  position: relative;
  overflow-x: hidden;
  overflow-y: auto;
  flex: 0 1 auto;
  max-height: 50vh;
  min-height: 0;
  overscroll-behavior: contain;
}

.si-body-pane {
  transition: all 200ms ease-in-out;
  width: 100%;
  padding: 8px 10px 16px;
  overflow-x: hidden;
  box-sizing: border-box;
}

/* ===== 表单控件 ===== */
.si-row {
  margin-bottom: 10px;
}

.si-row:last-child {
  margin-bottom: 0;
}

.si-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 3px;
}

.si-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 10px;
  font-size: 13px;
  font-family: var(--font);
  color: var(--text-primary);
  background: var(--fill-tsp-white-main);
  outline: none;
  transition: all 0.15s;
  box-sizing: border-box;
}

.si-input:focus {
  box-shadow: inset 0 0 0 1px var(--border-dark);
}

.si-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.si-grid3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 6px;
}

.si-color-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.si-color-swatch {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--border-dark);
  cursor: pointer;
  flex-shrink: 0;
}

.si-select {
  width: 100%;
  padding: 6px 24px 6px 8px;
  border: 1px solid transparent;
  border-radius: 10px;
  font-size: 12px;
  font-family: var(--font);
  color: var(--text-primary);
  background: var(--fill-tsp-white-main);
  outline: none;
  transition: all 0.15s;
  box-sizing: border-box;
}

.si-select:focus {
  box-shadow: inset 0 0 0 1px var(--border-dark);
}

/* ===== CommentMarkers（逆向自 CommentTooltip.tsx） ===== */
/* ===== OTHER 折叠分组 ===== */
.si-other-body.hidden {
  display: none;
}

.si-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transform: rotate(0deg);
  width: 16px;
  height: 16px;
}

.si-chevron.si-chevron-open {
  transform: rotate(180deg);
}

/* ===== CommentMarkers（逆向自 CommentTooltip.tsx） ===== */
.cm-badge {
  position: absolute;
  z-index: 2147483644;
  pointer-events: auto;
  cursor: pointer;
}

.cm-inner {
  padding: 5px 10px;
  background: #0081f2;
  border-radius: 10px;
  max-width: 260px;
  pointer-events: auto;
  cursor: pointer;
  position: relative;
}

.cm-inner:hover .cm-del {
  opacity: 1;
}

.cm-text {
  font-size: 12px;
  color: #fff;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.4;
}

.cm-del {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  opacity: 0;
  transition: opacity 0.15s;
  color: #666;
  font-size: 10px;
}

.cm-del:hover {
  color: #ef4444;
  background: #fef2f2;
}

/* Image preview & upload.
   The editor lives in the preview document, so page-level img/button styles can leak in. */
#siPanel .si-image-field,
#siPanel .si-image-field * {
  box-sizing: border-box !important;
}

#siPanel .si-image-field {
  gap: 6px !important;
}

#siPanel .si-image-preview-frame {
  position: relative !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 100% !important;
  height: 112px !important;
  border-radius: 10px !important;
  overflow: hidden !important;
  background: var(--fill-tsp-white-main) !important;
  border: 1px solid var(--border-main) !important;
  opacity: 1 !important;
  visibility: visible !important;
}

#siPanel .si-image-preview {
  position: static !important;
  inset: auto !important;
  display: block !important;
  width: auto !important;
  height: auto !important;
  min-width: 0 !important;
  min-height: 0 !important;
  max-width: 100% !important;
  max-height: 100% !important;
  object-fit: contain !important;
  margin: 0 auto !important;
  opacity: 1 !important;
  visibility: visible !important;
  transform: none !important;
  filter: none !important;
  z-index: auto !important;
  pointer-events: none !important;
}

#siPanel .si-image-preview-hidden {
  display: none !important;
}

#siPanel .si-image-source-row {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) 88px !important;
  gap: 8px !important;
  align-items: center !important;
  width: 100% !important;
  min-width: 0 !important;
  overflow: visible !important;
  opacity: 1 !important;
  visibility: visible !important;
}

#siPanel .si-image-source-input {
  width: auto !important;
  min-width: 0 !important;
  height: 32px !important;
}

#siPanel .si-image-upload-btn {
  appearance: none !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 88px !important;
  min-width: 88px !important;
  height: 32px !important;
  padding: 0 10px !important;
  border-radius: 10px !important;
  border: 1px solid var(--border-main) !important;
  background: var(--fill-tsp-white-main) !important;
  color: var(--text-primary) !important;
  font-family: var(--font) !important;
  font-size: 12px !important;
  font-weight: 500 !important;
  line-height: 1 !important;
  cursor: pointer !important;
  position: relative !important;
  z-index: 1 !important;
  opacity: 1 !important;
  visibility: visible !important;
  pointer-events: auto !important;
  white-space: nowrap !important;
  transform: none !important;
  box-shadow: none !important;
}

#siPanel .si-image-upload-btn:hover {
  box-shadow: inset 0 0 0 1px var(--border-dark) !important;
}

#siPanel .si-image-upload-btn:disabled {
  cursor: wait !important;
  opacity: 0.6 !important;
}

#siPanel .si-tabs,
#siPanel .si-tab {
  opacity: 1 !important;
  visibility: visible !important;
}

#siPanel .si-tab {
  appearance: none !important;
  display: block !important;
}
`,Cn=`/* eslint-disable */
(function (global) {
  'use strict';

  function getIframeDoc() {
    try {
      return global.editorIframe?.contentDocument || global.editorIframe?.contentWindow?.document;
    } catch (e) {
      return null;
    }
  }

  function getIframeWin() {
    try {
      return global.editorIframe?.contentWindow;
    } catch (e) {
      return null;
    }
  }

  function isElement(t) {
    return t && t.nodeType === 1;
  }

  function iframeContains(el) {
    const doc = getIframeDoc();
    try {
      return (doc || document).documentElement.contains(el);
    } catch (e) {
      return false;
    }
  }

  function toPageRect(el) {
    try {
      const iframe = global.editorIframe;
      if (!iframe) return null;
      const iframeRect = iframe.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      return {
        left: iframeRect.left + er.left,
        top: iframeRect.top + er.top,
        width: er.width,
        height: er.height,
        right: iframeRect.left + er.right,
        bottom: iframeRect.top + er.bottom,
      };
    } catch (e) {
      return null;
    }
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toHex(c) {
    if (!c) return '#000000';
    if (c.startsWith('#') && c.length >= 7) return c.slice(0, 7);
    const m = c.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
    if (m)
      return (
        '#' + [m[1], m[2], m[3]].map((v) => parseInt(v).toString(16).padStart(2, '0')).join('')
      );
    return '#000000';
  }

  const Ug = new Set([
    'P',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'A',
    'LI',
    'TD',
    'TH',
    'EM',
    'SPAN',
    'LABEL',
    'SMALL',
    'STRONG',
    'BUTTON',
  ]);

  function isDirectEditable(el) {
    if (!el) return false;
    if (el.nodeType === 3) return true;
    if (el.nodeType === 1) {
      // Container guard: if element has any block-level child elements,
      // it is a structural container and MUST NOT be made contenteditable.
      if (el.children && el.children.length > 0) {
        let hasBlockChild = false;
        const win = getIframeWin();
        for (let ci = 0; ci < el.children.length; ci++) {
          try {
            const cs = win ? win.getComputedStyle(el.children[ci]) : null;
            const d = cs ? cs.display : '';
            if (d && d !== 'inline' && d !== 'inline-block') {
              hasBlockChild = true;
              break;
            }
          } catch (e) {
            hasBlockChild = true;
            break;
          }
        }
        if (hasBlockChild) return false;
      }
      if (el.childNodes) {
        for (const child of Array.from(el.childNodes)) {
          if (child.nodeType === 3 && child.textContent?.trim()) return true;
        }
      }
      if (Ug.has(el.tagName)) return true;
      try {
        const win = getIframeWin();
        if (win) {
          const cs = win.getComputedStyle(el);
          if (['inline', 'inline-block'].includes(cs.display)) return true;
        }
      } catch (e) {}
    }
    return false;
  }

  /**
   * Determines if the element's text content should be shown in the editing panel.
   * Unlike isDirectEditable (which guards against contenteditable on containers),
   * this only checks if the element has meaningful text worth editing.
   */
  function hasEditableText(el) {
    if (!el) return false;
    if (el.nodeType === 3) return true;
    if (el.nodeType !== 1) return false;
    // Known text-bearing tags always show text field
    if (Ug.has(el.tagName)) return true;
    // Elements with direct text nodes
    if (el.childNodes) {
      for (const c of Array.from(el.childNodes)) {
        if (c.nodeType === 3 && c.textContent?.trim()) return true;
      }
    }
    // Inline/inline-block elements
    try {
      const win = getIframeWin();
      if (win) {
        const cs = win.getComputedStyle(el);
        if (['inline', 'inline-block'].includes(cs.display)) return true;
      }
    } catch (e) {}
    return false;
  }

  /**
   * Get only the direct text content of an element (not from child elements).
   * For leaf elements (no child elements), returns el.textContent.
   * For containers, returns only text from direct text nodes, which matches
   * what safeSetText will actually modify.
   */
  function getDirectText(el) {
    if (!el) return '';
    // Leaf element: no child elements, textContent is all direct
    if (!el.children || el.children.length === 0) {
      return el.textContent || '';
    }
    // Container: only collect text from direct text nodes
    let text = '';
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === 3) text += c.textContent || '';
    }
    return text;
  }

  /** Safely set text content without destroying child elements */
  function safeSetText(el, newText) {
    if (!el) return;
    // If element has no child elements, safe to use textContent directly
    if (!el.children || el.children.length === 0) {
      el.textContent = newText;
      return;
    }
    // Element has child elements - only update direct text nodes to preserve structure
    const textNodes = [];
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === 3) textNodes.push(c);
    }
    if (textNodes.length > 0) {
      textNodes[0].textContent = newText;
      for (let i = 1; i < textNodes.length; i++) {
        el.removeChild(textNodes[i]);
      }
    } else {
      // No text nodes exist, prepend a new one
      const doc = getIframeDoc();
      if (doc) {
        el.insertBefore(doc.createTextNode(newText), el.firstChild);
      } else {
        el.insertBefore(document.createTextNode(newText), el.firstChild);
      }
    }
  }

  const Hg = new Set(['app', 'root']);

  function isDeletable(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'HTML' || tag === 'BODY' || tag === 'HEAD') return false;
    if (el.id && Hg.has(el.id)) return false;
    return true;
  }

  function isIgnored(el) {
    if (!el || !el.tagName) return true;
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') return true;
    let p = el;
    while (p) {
      if (p.hasAttribute && p.hasAttribute('_editor_ignore')) return true;
      p = p.parentElement;
    }
    return false;
  }

  function getStyles(el) {
    try {
      const win = getIframeWin();
      if (!win) return {};
      const i = win.getComputedStyle(el);
      return {
        color: i.color,
        backgroundColor: i.backgroundColor,
        width: i.width,
        height: i.height,
        display: i.display,
        objectFit: i.objectFit,
        fontSize: i.fontSize,
        fontStyle: i.fontStyle,
        fontWeight: i.fontWeight,
        fontFamily: i.fontFamily,
        textAlign: i.textAlign,
        textDecoration: i.textDecoration,
        borderRadius: i.borderRadius,
        borderWidth: i.borderWidth,
        borderStyle: i.borderStyle,
        borderColor: i.borderColor,
        opacity: i.opacity,
        marginLeft: i.marginLeft,
        marginRight: i.marginRight,
        marginTop: i.marginTop,
        marginBottom: i.marginBottom,
        paddingLeft: i.paddingLeft,
        paddingRight: i.paddingRight,
        paddingTop: i.paddingTop,
        paddingBottom: i.paddingBottom,
      };
    } catch (e) {
      return {};
    }
  }

  function gl(el, attr) {
    const c = el[attr];
    if (!c) return '';
    if (typeof c === 'object' && 'baseVal' in c) return c.baseVal || '';
    if (typeof c === 'string') return c;
    if (attr === 'className') return el.getAttribute('class') || '';
    return el.getAttribute(attr) || '';
  }

  function getElementData(el) {
    const tag = el.tagName.toLowerCase();
    return {
      tagName: tag,
      id: el.id || '',
      isText: hasEditableText(el),
      isImage: el.tagName === 'IMG',
      isVideo: el.tagName === 'VIDEO',
      isCanvas: el.tagName === 'CANVAS',
      isLink: el.tagName === 'A',
      textContent: getDirectText(el),
      innerHTML: el.innerHTML,
      src: gl(el, 'src'),
      href: gl(el, 'href'),
      className: gl(el, 'className'),
      comment: el._comment || '',
      style: getStyles(el),
      window: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
    };
  }

  function isScrolledOutOfView(el) {
    if (!el) return true;
    const r = el.getBoundingClientRect();
    return r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth;
  }

  // ===== EditHistory =====
  class EditHistory {
    constructor() {
      this.history = [];
      this.currentIndex = -1;
      this.listeners = [];
    }

    addEdit(e) {
      this.history = this.history.slice(0, this.currentIndex + 1);
      this.history.push(e);
      this.currentIndex = this.history.length - 1;
      this._notify();
    }

    undo() {
      if (!this.canUndo()) return null;
      const e = this.history[this.currentIndex];
      if (e.changes.textContent && e.target && iframeContains(e.target))
        safeSetText(e.target, e.changes.textContent.original);
      if (e.changes.style && e.target && iframeContains(e.target)) {
        for (const [prop, val] of Object.entries(e.changes.style)) {
          const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
          if (val.original) {
            e.target.style.setProperty(cssProp, val.original, 'important');
            if (prop === 'height') e.target.style.setProperty('min-height', 'auto', 'important');
          } else {
            e.target.style.removeProperty(cssProp);
          }
        }
      }
      if (e.changes.src && e.target) {
        try {
          e.target.src = e.changes.src.original;
        } catch (x) {}
      }
      if (e.changes.href && e.target) {
        try {
          e.target.href = e.changes.href.original;
        } catch (x) {}
      }
      if (e.changes.comment && e.target)
        e.target._comment = e.changes.comment.original || undefined;
      if (e.changes.deleted && e.target && e.changes.deleted.parent) {
        try {
          e.changes.deleted.parent.insertBefore(e.target, e.changes.deleted.nextSibling || null);
        } catch (x) {}
      }
      this.currentIndex--;
      this._notify();
      return e;
    }

    redo() {
      if (!this.canRedo()) return null;
      this.currentIndex++;
      const e = this.history[this.currentIndex];
      if (e.changes.textContent && e.target && iframeContains(e.target))
        safeSetText(e.target, e.changes.textContent.modified);
      if (e.changes.style && e.target && iframeContains(e.target)) {
        for (const [prop, val] of Object.entries(e.changes.style)) {
          const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
          if (val.modified) {
            e.target.style.setProperty(cssProp, val.modified, 'important');
            if (prop === 'height') e.target.style.setProperty('min-height', 'auto', 'important');
          } else {
            e.target.style.removeProperty(cssProp);
          }
        }
      }
      if (e.changes.src && e.target) {
        try {
          e.target.src = e.changes.src.modified;
        } catch (x) {}
      }
      if (e.changes.href && e.target) {
        try {
          e.target.href = e.changes.href.modified;
        } catch (x) {}
      }
      if (e.changes.comment && e.target)
        e.target._comment = e.changes.comment.modified || undefined;
      if (e.changes.deleted && e.target && e.target.parentElement) {
        try {
          e.target.parentElement.removeChild(e.target);
        } catch (x) {}
      }
      this._notify();
      return e;
    }

    canUndo() {
      return this.currentIndex >= 0;
    }
    canRedo() {
      return this.currentIndex < this.history.length - 1;
    }
    hasEdits() {
      return this.currentIndex >= 0;
    }
    getActiveEdits() {
      return this.history.slice(0, this.currentIndex + 1);
    }

    clear() {
      const edits = this.getActiveEdits();
      for (let i = edits.length - 1; i >= 0; i--) {
        const e = edits[i];
        if (e.changes.textContent && e.target && iframeContains(e.target))
          safeSetText(e.target, e.changes.textContent.original);
        if (e.changes.style && e.target && iframeContains(e.target)) {
          for (const [prop, val] of Object.entries(e.changes.style)) {
            const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
            if (val.original) {
              e.target.style.setProperty(cssProp, val.original, 'important');
              if (prop === 'height') e.target.style.setProperty('min-height', 'auto', 'important');
            } else {
              e.target.style.removeProperty(cssProp);
            }
          }
        }
        if (e.changes.src && e.target) {
          try { e.target.src = e.changes.src.original; } catch (x) {}
        }
        if (e.changes.href && e.target) {
          try { e.target.href = e.changes.href.original; } catch (x) {}
        }
        if (e.changes.comment && e.target) {
          if (e.changes.comment.original) e.target._comment = e.changes.comment.original;
          else delete e.target._comment;
        }
        if (e.changes.deleted && e.target && e.changes.deleted.parent) {
          try {
            e.changes.deleted.parent.insertBefore(e.target, e.changes.deleted.nextSibling || null);
          } catch (x) {}
        }
      }
      this.history = [];
      this.currentIndex = -1;
      this._notify();
    }

    clearComments() {
      const edits = this.getActiveEdits();
      const ids = new Set();
      for (const e of edits) {
        if (e.changes.comment) ids.add(e.targetData?.id || '');
      }
      for (const id of ids) {
        const edit = edits.find((e) => (e.targetData?.id || '') === id);
        if (edit?.target && edit.target._comment) delete edit.target._comment;
      }

      this.history = this.history
        .map((e) => {
          if (!e.changes.comment) return e;
          const { comment, ...rest } = e.changes;
          if (
            rest.textContent ||
            rest.src ||
            rest.href ||
            rest.className ||
            rest.deleted ||
            (rest.style && Object.keys(rest.style).length > 0)
          ) {
            return { ...e, changes: rest };
          }
          return null;
        })
        .filter((e) => e !== null);

      if (this.currentIndex >= this.history.length) {
        this.currentIndex = this.history.length - 1;
      }
      this._notify();
    }

    onChange(fn) {
      this.listeners.push(fn);
      return () => {
        this.listeners = this.listeners.filter((f) => f !== fn);
      };
    }

    _notify() {
      this.listeners.forEach((fn) => fn());
    }
  }

  // 暴露全局 API
  global.__BA_Html_Editor__ = {
    EditHistory,
    utils: {
      isElement,
      iframeContains,
      toPageRect,
      esc,
      toHex,
      isDirectEditable,
      isDeletable,
      isIgnored,
      getElementData,
      isScrolledOutOfView,
    },
  };
})(typeof window !== 'undefined' ? window : this);
`,In=`/* eslint-disable */
// 在 iframe 内执行的编辑器初始化脚本，包含 Highlighter / DomSelector / SelectorInput / EditToolbar
(function () {
  'use strict';

  // ===== 获取 editor-bundle 暴露的 API =====
  const BA = window.__BA_Html_Editor__ || {};
  const EditHistory = BA.EditHistory;

  // ===== 获取注入的 locale =====
  const L = window.__BA_EDITOR_LOC__ || {};
  const editHistory = EditHistory ? new EditHistory() : null;

  // ===== 编辑器常量
  const EDITOR_UI_IDS = ['hlCanvas', 'etbWrap', 'siOverlay', 'cmSvg', 'cmBox'];
  const EDITOR_UI_ID_SET = new Set(EDITOR_UI_IDS);

  // 快照与导出共用，保证两处序列化格式一致
  function getCleanBodyHtml() {
    const clone = document.body.cloneNode(true);
    EDITOR_UI_IDS.forEach((id) => {
      const el = clone.querySelector('#' + id);
      if (el) el.remove();
    });
    clone.querySelectorAll('script').forEach((s) => s.remove());
    return clone.innerHTML;
  }

  // 过滤 computed style vs inline style 的语义等价噪音（如 '0px' vs ''）
  const CSS_DEFAULT_KEYWORDS = new Set(['auto', 'none', 'normal', 'initial', 'unset', 'inherit']);
  const CSS_ZERO_VALUE_RE = /^0(px|em|rem|%|vh|vw|pt|cm|mm|vmin|vmax|ch|ex)?$/i;
  function isCssDefault(v) {
    const s = (v || '').trim();
    return s === '' || CSS_ZERO_VALUE_RE.test(s) || CSS_DEFAULT_KEYWORDS.has(s);
  }

  // ===== 工具函数 =====
  function isElement(t) {
    return t && t.nodeType === 1;
  }
  
  // 检查元素是否仍然有效（存在于 DOM 中）
  function isValidElement(el) {
    if (!el || !el.tagName) return false;
    try {
      return document.documentElement.contains(el) || document.body.contains(el);
    } catch (e) {
      return false;
    }
  }
  function iframeContains(el) {
    try {
      return document.documentElement.contains(el);
    } catch (e) {
      return false;
    }
  }
  function resetBodyWrapScroll() {
    const bodyWrap = document.querySelector('.si-body-wrap');
    if (bodyWrap) {
      void bodyWrap.offsetHeight;
      bodyWrap.scrollTop = 0;
    }
  }
  function toPageRect(el) {
    try {
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        right: r.right,
        bottom: r.bottom,
      };
    } catch (e) {
      return null;
    }
  }
  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function toHex(c) {
    if (!c) return '#000000';
    if (c.startsWith('#') && c.length >= 7) return c.slice(0, 7);
    const m = c.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
    if (m)
      return (
        '#' + [m[1], m[2], m[3]].map((v) => parseInt(v).toString(16).padStart(2, '0')).join('')
      );
    return '#000000';
  }
  function applyImageSourceToTarget(target, url) {
    if (!target || !url) return;
    if ('src' in target) target.src = url;
    try {
      target.setAttribute('src', url);
      // When srcset exists, browsers may keep rendering the old candidate even after src changes.
      if (target.hasAttribute('srcset')) target.setAttribute('srcset', url);
      ['data-src', 'data-original', 'data-lazy-src', 'data-url'].forEach((attr) => {
        if (target.hasAttribute(attr)) target.setAttribute(attr, url);
      });
    } catch (e) {
      console.warn('[applyImageSourceToTarget] Failed to set image attributes:', e);
    }
  }
  function syncImageEditorSource(url, displayUrl) {
    if (!url) return;
    applyImageSourceToTarget(siTarget, displayUrl || url);
    const srcInput = document.getElementById('siFieldSrc');
    if (srcInput) srcInput.value = url;
    const preview = document.getElementById('siImagePreview');
    if (preview) {
      preview.src = displayUrl || url;
      preview.classList.remove('si-image-preview-hidden');
    }
    showETB();
    updateETB();
    updateActionButton();
    hl.scheduleRender();
  }
  const imageUploadRequests = new Map();
  function requestImageUpload(file) {
    const requestId = \`\${Date.now()}-\${Math.random().toString(36).slice(2)}\`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        imageUploadRequests.delete(requestId);
        reject(new Error('image upload timeout'));
      }, 60000);
      imageUploadRequests.set(requestId, {
        resolve: (url) => {
          clearTimeout(timer);
          resolve(url);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      window.parent.postMessage(
        { type: 'IMAGE_UPLOAD_REQUEST', data: { requestId, fileName: file.name, file } },
        '*',
      );
    });
  }
  function isIgnored(el) {
    if (!el || !el.tagName) return true;
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CANVAS') return true;
    
    let p = el;
    let safetyCounter = 0;
    const MAX_ITERATIONS = 100; // 防止无限循环
    
    while (p && safetyCounter < MAX_ITERATIONS) {
      safetyCounter++;
      try {
        if (p.hasAttribute && (p.hasAttribute('_editor_ignore') || EDITOR_UI_ID_SET.has(p.id)))
          return true;
        if (
          p.classList &&
          (p.classList.contains('etb-wrap') ||
            p.classList.contains('si-overlay') ||
            p.classList.contains('si-panel'))
        )
          return true;
        p = p.parentElement;
      } catch (e) {
        // 如果访问元素属性时出错（可能已失效），认为应该忽略
        return true;
      }
    }
    return false;
  }
  const Ug = new Set([
    'P',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'A',
    'LI',
    'TD',
    'TH',
    'EM',
    'SPAN',
    'LABEL',
    'SMALL',
    'STRONG',
    'BUTTON',
  ]);
  function isDirectEditable(el) {
    if (!el) return false;
    if (el.nodeType === 3) return true;
    if (el.nodeType === 1) {
      // Container guard: if element has any block-level child elements,
      // it is a structural container and MUST NOT be made contenteditable.
      // Setting contenteditable on such elements causes the browser to flatten
      // the entire child DOM tree, destroying layout and styling.
      if (el.children && el.children.length > 0) {
        let hasBlockChild = false;
        for (let ci = 0; ci < el.children.length; ci++) {
          try {
            const childCs = window.getComputedStyle(el.children[ci]);
            const d = childCs.display;
            if (d && d !== 'inline' && d !== 'inline-block') {
              hasBlockChild = true;
              break;
            }
          } catch (e) {
            hasBlockChild = true;
            break;
          }
        }
        if (hasBlockChild) return false;
      }
      if (el.childNodes) {
        for (const c of Array.from(el.childNodes)) {
          if (c.nodeType === 3 && c.textContent?.trim()) return true;
        }
      }
      if (Ug.has(el.tagName)) return true;
      try {
        const cs = window.getComputedStyle(el);
        if (['inline', 'inline-block'].includes(cs.display)) return true;
      } catch (e) {}
    }
    return false;
  }
  /**
   * Determines if the element's text content should be shown in the editing panel.
   * Unlike isDirectEditable (which guards against contenteditable on containers),
   * this only checks if the element has meaningful text worth editing.
   */
  function hasEditableText(el) {
    if (!el) return false;
    if (el.nodeType === 3) return true;
    if (el.nodeType !== 1) return false;
    // Known text-bearing tags always show text field
    if (Ug.has(el.tagName)) return true;
    // Elements with direct text nodes
    if (el.childNodes) {
      for (const c of Array.from(el.childNodes)) {
        if (c.nodeType === 3 && c.textContent?.trim()) return true;
      }
    }
    // Inline/inline-block elements
    try {
      const cs = window.getComputedStyle(el);
      if (['inline', 'inline-block'].includes(cs.display)) return true;
    } catch (e) {}
    return false;
  }

  /**
   * Get only the direct text content of an element (not from child elements).
   * For leaf elements (no child elements), returns el.textContent.
   * For containers, returns only text from direct text nodes, which matches
   * what safeSetText will actually modify.
   */
  function getDirectText(el) {
    if (!el) return '';
    // Leaf element: no child elements, textContent is all direct
    if (!el.children || el.children.length === 0) {
      return el.textContent || '';
    }
    // Container: only collect text from direct text nodes
    let text = '';
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === 3) text += c.textContent || '';
    }
    return text;
  }

  /** Safely set text content without destroying child elements */
  function safeSetText(el, newText) {
    if (!el) return;
    // If element has no child elements, safe to use textContent directly
    if (!el.children || el.children.length === 0) {
      el.textContent = newText;
      return;
    }
    // Element has child elements - only update direct text nodes to preserve structure
    const textNodes = [];
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === 3) textNodes.push(c);
    }
    if (textNodes.length > 0) {
      textNodes[0].textContent = newText;
      for (let i = 1; i < textNodes.length; i++) {
        el.removeChild(textNodes[i]);
      }
    } else {
      // No text nodes exist, prepend a new one
      el.insertBefore(document.createTextNode(newText), el.firstChild);
    }
  }

  const Hg = new Set(['app', 'root']);
  function isDeletable(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'HTML' || tag === 'BODY' || tag === 'HEAD') return false;
    if (el.id && Hg.has(el.id)) return false;
    return true;
  }
  function getStyles(el) {
    try {
      const i = window.getComputedStyle(el);
      return {
        color: i.color,
        backgroundColor: i.backgroundColor,
        width: i.width,
        height: i.height,
        display: i.display,
        objectFit: i.objectFit,
        fontSize: i.fontSize,
        fontStyle: i.fontStyle,
        fontWeight: i.fontWeight,
        fontFamily: i.fontFamily,
        textAlign: i.textAlign,
        textDecoration: i.textDecoration,
        borderRadius: i.borderRadius,
        borderWidth: i.borderWidth,
        borderStyle: i.borderStyle,
        borderColor: i.borderColor,
        opacity: i.opacity,
        marginLeft: i.marginLeft,
        marginRight: i.marginRight,
        marginTop: i.marginTop,
        marginBottom: i.marginBottom,
        paddingLeft: i.paddingLeft,
        paddingRight: i.paddingRight,
        paddingTop: i.paddingTop,
        paddingBottom: i.paddingBottom,
      };
    } catch (e) {
      return {};
    }
  }
  function gl(el, attr) {
    const c = el[attr];
    if (!c) return '';
    if (typeof c === 'object' && 'baseVal' in c) return c.baseVal || '';
    if (typeof c === 'string') return c;
    if (attr === 'className') return el.getAttribute('class') || '';
    return el.getAttribute(attr) || '';
  }
  function getElementData(el) {
    const tag = el.tagName.toLowerCase();
    return {
      tagName: tag,
      id: el.id || '',
      isText: hasEditableText(el),
      isImage: el.tagName === 'IMG',
      isVideo: el.tagName === 'VIDEO',
      isCanvas: el.tagName === 'CANVAS',
      isLink: el.tagName === 'A',
      textContent: getDirectText(el),
      innerHTML: el.innerHTML,
      src: gl(el, 'src'),
      href: gl(el, 'href'),
      className: gl(el, 'className'),
      comment: el._comment || '',
      style: getStyles(el),
      window: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
    };
  }
  function isScrolledOutOfView(el) {
    if (!el) return true;
    const r = el.getBoundingClientRect();
    return r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth;
  }

  // ===== Highlighter =====
  const hlCanvas = document.getElementById('hlCanvas');
  const hlCtx = hlCanvas ? hlCanvas.getContext('2d') : null;
  const Mu = 2.5,
    xg = [8, 4],
    wg = '#0081f2',
    Sg = 'rgba(0,0,0,0)',
    Au = 'rgba(0,122,255,0.08)';

  const hl = {
    hoverTarget: null,
    activeTarget: null,
    frameRequested: false,
    exclusionRects: new Map(),
    currentDpr: 0,
    setHoverTarget(el) {
      if (this.hoverTarget !== el) {
        this.hoverTarget = el;
        this.scheduleRender();
      }
    },
    setActiveTarget(el) {
      if (this.activeTarget !== el) {
        this.activeTarget = el;
        this.scheduleRender();
      }
    },
    addExclusionRect(k, r) {
      this.exclusionRects.set(k, r);
      this.scheduleRender();
    },
    removeExclusionRect(k) {
      this.exclusionRects.delete(k);
      this.scheduleRender();
    },
    clear() {
      this.hoverTarget = null;
      this.activeTarget = null;
      this.scheduleRender();
    },
    scheduleRender() {
      if (this.frameRequested) return;
      this.frameRequested = true;
      requestAnimationFrame(() => {
        this.frameRequested = false;
        this.render();
      });
    },
    _updateDimensions() {
      if (!hlCanvas || !hlCtx) return;
      const dpr = window.devicePixelRatio || 1;
      const W = window.innerWidth,
        H = window.innerHeight;
      if (
        Math.abs(dpr - this.currentDpr) > 0.01 ||
        hlCanvas.width !== W * dpr ||
        hlCanvas.height !== H * dpr
      ) {
        this.currentDpr = dpr;
        hlCanvas.width = W * dpr;
        hlCanvas.height = H * dpr;
        hlCanvas.style.width = W + 'px';
        hlCanvas.style.height = H + 'px';
        hlCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    },
    render() {
      if (!hlCtx) return;
      this._updateDimensions();
      const W = window.innerWidth,
        H = window.innerHeight;
      hlCtx.clearRect(0, 0, W, H);
      hlCtx.setLineDash([]);
      const act = this._getDrawable(this.activeTarget);
      const hov = this._getDrawable(this.hoverTarget);
      if (!act && !hov) return;
      hlCtx.save();
      if (this.exclusionRects.size > 0) {
        hlCtx.beginPath();
        hlCtx.rect(0, 0, W, H);
        for (const r of this.exclusionRects.values())
          hlCtx.rect(r.left || r.x, r.top || r.y, r.width, r.height);
        hlCtx.clip('evenodd');
      }
      if (act) this._drawNu(act, { fillColor: Sg });
      if (hov && hov !== act) this._drawNu(hov, { lineDash: xg });
      hlCtx.restore();
    },
    _getDrawable(el) {
      if (!el || !iframeContains(el)) return null;
      const r = toPageRect(el);
      return r && r.width > 0 && r.height > 0 ? el : null;
    },
    _drawNu(el, opts = {}) {
      const r = toPageRect(el);
      if (!r || r.width <= 0 || r.height <= 0) return;
      const ctx = hlCtx;
      if (opts.lineDash) ctx.setLineDash(opts.lineDash);
      else ctx.setLineDash([]);
      let radii = { tl: 0, tr: 0, bl: 0, br: 0 };
      try {
        const cs = window.getComputedStyle(el);
        const pr = (v, rect) => {
          if (!v) return 0;
          const n = parseFloat(v);
          if (isNaN(n)) return 0;
          return v.includes('%') ? (n / 100) * Math.min(rect.width, rect.height) : n;
        };
        radii.tl = pr(cs.borderTopLeftRadius, r);
        radii.tr = pr(cs.borderTopRightRadius, r);
        radii.bl = pr(cs.borderBottomLeftRadius, r);
        radii.br = pr(cs.borderBottomRightRadius, r);
      } catch (e) {}
      ctx.beginPath();
      if (radii.tl > 0 || radii.tr > 0 || radii.br > 0 || radii.bl > 0) {
        ctx.moveTo(r.left + radii.tl, r.top);
        ctx.lineTo(r.left + r.width - radii.tr, r.top);
        ctx.arcTo(r.left + r.width, r.top, r.left + r.width, r.top + radii.tr, radii.tr);
        ctx.lineTo(r.left + r.width, r.top + r.height - radii.br);
        ctx.arcTo(
          r.left + r.width,
          r.top + r.height,
          r.left + r.width - radii.br,
          r.top + r.height,
          radii.br,
        );
        ctx.lineTo(r.left + radii.bl, r.top + r.height);
        ctx.arcTo(r.left, r.top + r.height, r.left, r.top + r.height - radii.bl, radii.bl);
        ctx.lineTo(r.left, r.top + radii.tl);
        ctx.arcTo(r.left, r.top, r.left + radii.tl, r.top, radii.tl);
      } else {
        ctx.rect(r.left, r.top, r.width, r.height);
      }
      ctx.lineWidth = opts.lineWidth ?? Mu;
      ctx.strokeStyle = wg;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.fillStyle = opts.fillColor ?? Au;
      ctx.fill();
      ctx.shadowColor = 'rgba(0,122,255,0.3)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.stroke();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      this._drawTag(r, el.tagName.toLowerCase());
    },
    _drawTag(rect, tag) {
      const ctx = hlCtx;
      const pad = 8,
        vpad = 4,
        fs = 10,
        gap = 8;
      ctx.font = \`600 \${fs}px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif\`;
      const tw = ctx.measureText(tag).width;
      const lw = tw + pad * 2,
        lh = fs + vpad * 2 + 2;
      const pos = { x: rect.left, y: rect.top - lh - gap };
      if (pos.y < 0) pos.y = rect.top + rect.height + gap;
      const W = window.innerWidth;
      if (pos.x < gap) pos.x = gap;
      else if (pos.x + lw > W - gap) pos.x = W - lw - gap;
      ctx.setLineDash([]);
      ctx.fillStyle = '#0081f2';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(pos.x, pos.y, lw, lh, 6);
      else {
        ctx.moveTo(pos.x + 6, pos.y);
        ctx.lineTo(pos.x + lw - 6, pos.y);
        ctx.arcTo(pos.x + lw, pos.y, pos.x + lw, pos.y + 6, 6);
        ctx.lineTo(pos.x + lw, pos.y + lh - 6);
        ctx.arcTo(pos.x + lw, pos.y + lh, pos.x + lw - 6, pos.y + lh, 6);
        ctx.lineTo(pos.x + 6, pos.y + lh);
        ctx.arcTo(pos.x, pos.y + lh, pos.x, pos.y + lh - 6, 6);
        ctx.lineTo(pos.x, pos.y + 6);
        ctx.arcTo(pos.x, pos.y, pos.x + 6, pos.y, 6);
      }
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = 'rgba(0,81,213,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 2;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 1;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tag, pos.x + lw / 2, pos.y + lh / 2);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    },
  };

  // ===== 全局状态 =====
  let mode = 'preview';

  // ===== EditToolbar =====
  const etbWrap = document.getElementById('etbWrap');
  function showETB() {
    // Only show toolbar when there are confirmed edits in history
    if (!editHistory || !editHistory.hasEdits()) return;
    if (etbWrap) etbWrap.classList.remove('hidden');
  }
  function hideETB() {
    if (etbWrap) etbWrap.classList.add('hidden');
  }
  function updateETB() {
    if (!editHistory) return;
    const edits = editHistory.getActiveEdits();
    const n = document.getElementById('badgeN');
    if (n) n.textContent = String(edits.length);
    // Auto-hide toolbar when there are no edits
    if (edits.length === 0) {
      hideETB();
    }
    const uBtn = document.getElementById('uBtn'),
      rBtn = document.getElementById('rBtn');
    if (uBtn) uBtn.disabled = !editHistory.canUndo();
    if (rBtn) rBtn.disabled = !editHistory.canRedo();
    const disBtn = document.getElementById('disBtn'),
      appBtn = document.getElementById('appBtn');
    // Apply/Discard 可点击条件：editHistory 中有已确认的记录
    const has = editHistory.hasEdits();
    if (disBtn) disBtn.disabled = !has;
    if (appBtn) {
      appBtn.disabled = !has;
    }
  }
  function renderComments() {}

  // ===== SelectorInput =====
  let siTab = 'styles',
    siData = null,
    siTarget = null,
    siResizeOb = null,
    siOrigData = null,
    siPanelOpenData = null, // 保存面板打开时的真正原始数据快照
    siOrigInlineStyle = null, // 保存面板打开时元素的原始 inline style（用于精确还原）
    siImagePreviewObjectUrl = null,
    siModifiedInlineProps = {}; // 编辑器实际修改过的 CSS 属性 → 首次修改前的 inline 值
  const $panel = () => document.getElementById('siPanel');
  const $comment = () => document.getElementById('siComment');
  const $closeBtn = () => document.getElementById('siCloseBtn');
  const $confirmBtn = () => document.getElementById('siConfirmBtn');
  const $contentArea = () => document.getElementById('siContentArea');
  const $tabStyle = () => document.getElementById('siTabStyle');
  const $tabLayout = () => document.getElementById('siTabLayout');
  const $paneStyle = () => document.getElementById('siPaneStyle');
  const $paneLayout = () => document.getElementById('siPaneLayout');

  function openSI(el) {
    siTarget = el;
    // 保存元素的原始 inline style，用于 discard 时精确还原
    siOrigInlineStyle = el.style.cssText;
    siModifiedInlineProps = {};
    siData = getElementData(el);
    siOrigData = getElementData(el);
    siPanelOpenData = getElementData(el);
    const p = $panel();
    if (!p) return;
    
    p.style.opacity = '0';
    p.style.transform = 'scale(0.95)';
    p.style.display = ''; // 清除强制隐藏
    p.classList.remove('hidden');
    
    siTab = 'styles';
    const c = $comment();
    if (c) {
      c.value = siData.comment || '';
      autoResizeComment();
    }
    renderContentArea();
    renderStylePane();
    renderLayoutPane();
    applyTabState();
    updateActionButton();
    resetBodyWrapScroll();
    positionSI(el);
    if (!siResizeOb) {
      siResizeOb = new ResizeObserver(() => {
        if (siTarget) positionSI(siTarget, true);
      });
    }
    siResizeOb.observe(p);
    if (c) {
      c.addEventListener('input', onCommentInput);
      c.addEventListener('keydown', onCommentKeydown);
    }
    
    const closeBtn = $closeBtn();
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        discardSI();
      };
    }
    
    requestAnimationFrame(() => {
      p.style.opacity = '1';
      p.style.transform = 'scale(1)';
    });
  }

  function closeSI() {
    const p = $panel();
    if (p) {
      try {
        p.classList.add('hidden');
        p.style.opacity = '0';
        p.style.transform = 'scale(0.95)';
        p.style.display = 'none'; // 强制隐藏
      } catch (e) {
        console.warn('[closeSI] failed to hide panel:', e);
      }
    }
    
    try {
      if (siResizeOb) siResizeOb.disconnect();
    } catch (e) {}
    siResizeOb = null;
    
    try {
      hl.removeExclusionRect('control-panel');
    } catch (e) {}
    
    try {
      const c = $comment();
      if (c) {
        c.removeEventListener('input', onCommentInput);
        c.removeEventListener('keydown', onCommentKeydown);
      }
    } catch (e) {}
    
    try {
      const closeBtn = $closeBtn();
      if (closeBtn) closeBtn.onclick = null;
    } catch (e) {}
    
    siTarget = null;
    siData = null;
    siOrigData = null;
    siPanelOpenData = null;
    siOrigInlineStyle = null;
    if (siImagePreviewObjectUrl) {
      URL.revokeObjectURL(siImagePreviewObjectUrl);
      siImagePreviewObjectUrl = null;
    }
    siModifiedInlineProps = {};
    // 清空 activeTarget，确保下次点击同一元素时能重新弹出面板
    activeTarget = null;
    hoverTarget = null;
    hl.setActiveTarget(null);
    hl.setHoverTarget(null);
  }

  let _debouncedAutoSaveFn = null;
  function debouncedAutoSave() {
    if (!_debouncedAutoSaveFn) {
      const debounce = window.__BA_debounce__;
      _debouncedAutoSaveFn = debounce ? debounce(autoSaveSI, 500) : null;
    }
    if (_debouncedAutoSaveFn) _debouncedAutoSaveFn();
    else autoSaveSI();
  }

  /**
   * 自动保存面板中的变更到 editHistory
   * 每次编辑操作后调用（通过防抖），将变更写入 editHistory 并更新 badge
   */
  function autoSaveSI() {
    if (!siTarget || !siOrigData) return;
    const changes = {};
    const commentValue = ($comment()?.value || '').trim();
    if (commentValue !== (siOrigData.comment || '')) {
      changes.comment = { original: siOrigData.comment || '', modified: commentValue };
      if (commentValue) siTarget._comment = commentValue;
      else delete siTarget._comment;
    }
    const txt = document.getElementById('siFieldText');
    if (txt && txt.value !== siOrigData.textContent)
      changes.textContent = { original: siOrigData.textContent, modified: txt.value };
    const src = document.getElementById('siFieldSrc');
    if (src && src.value !== siOrigData.src)
      changes.src = { original: siOrigData.src, modified: src.value };
    const href = document.getElementById('siFieldHref');
    if (href && href.value !== siOrigData.href)
      changes.href = { original: siOrigData.href, modified: href.value };
    collectStyleChanges(changes);
    if (Object.keys(changes).length > 0 && editHistory) {
      editHistory.addEdit({
        target: siTarget,
        targetData: siOrigData,
        changes: changes,
        screenshot: null,
      });
      // 保存后更新 siOrigData，避免重复记录相同的变更
      siOrigData = getElementData(siTarget);
      showETB();
      updateETB();
      hl.scheduleRender();
      renderComments();
    }
  }

  function autoResizeComment() {
    const c = $comment();
    if (!c) return;
    c.style.height = 'auto';
    c.style.height = c.scrollHeight + 'px';
  }
  function onCommentInput() {
    autoResizeComment();
    updateActionButton();
    showETB();
    updateETB();
  }
  function onCommentKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      discardSI();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      confirmSI();
    }
  }

  function hasChanges() {
    if (!siOrigData || !siTarget) return false;
    const cv = ($comment()?.value || '').trim();
    if (cv !== (siOrigData.comment || '')) return true;
    const txt = document.getElementById('siFieldText');
    if (txt && txt.value !== siOrigData.textContent) return true;
    const src = document.getElementById('siFieldSrc');
    if (src && src.value !== siOrigData.src) return true;
    const href = document.getElementById('siFieldHref');
    if (href && href.value !== siOrigData.href) return true;
    const tempChanges = {};
    collectStyleChanges(tempChanges);
    if (tempChanges.style && Object.keys(tempChanges.style).length > 0) return true;
    return false;
  }

  function updateActionButton() {
    const confirmBtn = $confirmBtn();
    if (!confirmBtn) return;
    const changed = hasChanges();
    confirmBtn.disabled = !changed;
  }

  /**
   * 确认按钮：将当前面板的变更保存到 editHistory，然后关闭面板
   */
  function confirmSI() {
    if (!siTarget || !siOrigData) return;
    autoSaveSI();
    closeSI();
  }

  function saveSI() {
    if (siTarget && siOrigData && hasChanges()) {
      autoSaveSI();
    }
    closeSI();
  }

  function discardSI() {
    if (siTarget && siOrigData) {
      if (siOrigData.textContent !== undefined) {
        safeSetText(siTarget, siOrigData.textContent);
      }
      if ('src' in siTarget && siOrigData.src !== undefined)
        try {
          siTarget.src = siOrigData.src;
        } catch (e) {}
      if ('href' in siTarget && siOrigData.href !== undefined)
        try {
          siTarget.href = siOrigData.href;
        } catch (e) {}
      // 只撤销编辑器实际修改过的属性，避免覆盖页面动画设置的 opacity/transform 等
      for (const [cp, origVal] of Object.entries(siModifiedInlineProps)) {
        if (origVal) siTarget.style.setProperty(cp, origVal);
        else siTarget.style.removeProperty(cp);
      }
      siModifiedInlineProps = {};
      delete siTarget._comment;
      if (siOrigData.comment) siTarget._comment = siOrigData.comment;
    }
    // discard 时跳过自动保存，直接清理面板状态
    siTarget = null;
    siOrigData = null;
    siPanelOpenData = null;
    siOrigInlineStyle = null;
    if (siImagePreviewObjectUrl) {
      URL.revokeObjectURL(siImagePreviewObjectUrl);
      siImagePreviewObjectUrl = null;
    }
    const p = $panel();
    if (!p) return;
    p.classList.add('hidden');
    p.style.opacity = '0';
    p.style.transform = 'scale(0.95)';
    p.style.display = 'none'; // 强制隐藏，防止原生 select 下拉框在隐藏态被触发
    if (siResizeOb) siResizeOb.disconnect();
    hl.removeExclusionRect('control-panel');
    try {
      const c = $comment();
      c.removeEventListener('input', onCommentInput);
      c.removeEventListener('keydown', onCommentKeydown);
    } catch (e) {}
    siData = null;
  }

  function collectStyleChanges(changes) {
    if (!siOrigData) return;
    const sc = {};
    const check = (id, prop, unit = '') => {
      const el = document.getElementById(id);
      if (!el) return;
      const ov = siOrigData.style[prop] || '',
        nv = el.value ? el.value + unit : '';
      if (nv !== ov && !(parseFloat(nv) === parseFloat(ov)))
        sc[prop] = { original: ov, modified: nv };
    };
    const checkRaw = (id, prop) => {
      const el = document.getElementById(id);
      if (!el) return;
      const ov = siOrigData.style[prop] || '',
        nv = el.value || '';
      if (nv !== ov) sc[prop] = { original: ov, modified: nv };
    };
    const checkColor = (txtId, prop) => {
      const el = document.getElementById(txtId);
      if (el && el.value !== siOrigData.style[prop])
        sc[prop] = { original: siOrigData.style[prop], modified: el.value };
    };
    checkColor('siColorTxt', 'color');
    checkColor('siBgTxt', 'backgroundColor');
    check('siFontSize', 'fontSize', 'px');
    checkRaw('siFontWeight', 'fontWeight');
    checkRaw('siFontStyle', 'fontStyle');
    checkRaw('siAlign', 'textAlign');
    checkRaw('siDecor', 'textDecoration');
    checkRaw('siDisplay', 'display');
    checkRaw('siObjFit', 'objectFit');
    checkRaw('siOp', 'opacity');
    check('siPT', 'paddingTop', 'px');
    check('siPR', 'paddingRight', 'px');
    check('siPB', 'paddingBottom', 'px');
    check('siPL', 'paddingLeft', 'px');
    check('siMT', 'marginTop', 'px');
    check('siMR', 'marginRight', 'px');
    check('siMB', 'marginBottom', 'px');
    check('siML', 'marginLeft', 'px');
    check('siW', 'width', 'px');
    check('siH', 'height', 'px');
    check('siBW', 'borderWidth', 'px');
    check('siBR', 'borderRadius', 'px');
    checkRaw('siBS', 'borderStyle');
    if (Object.keys(sc).length > 0) changes.style = sc;
  }

  function setSITab(t) {
    siTab = t;
    const sty = $paneStyle(), lay = $paneLayout();
    if (sty) sty.style.transition = 'none';
    if (lay) lay.style.transition = 'none';
    applyTabState();
    resetBodyWrapScroll();
    requestAnimationFrame(() => {
      if (sty) sty.style.transition = '';
      if (lay) lay.style.transition = '';
    });
  }

  function applyTabState() {
    const ts = $tabStyle(),
      tl = $tabLayout();
    if (!ts || !tl) return;
    ts.classList.toggle('active', siTab === 'styles');
    tl.classList.toggle('active', siTab === 'spacing');
    const sty = $paneStyle(),
      lay = $paneLayout();
    if (!sty || !lay) return;
    if (siTab === 'styles') {
      Object.assign(sty.style, {
        opacity: '1',
        transform: 'translateX(0)',
        position: 'relative',
        pointerEvents: 'auto',
        visibility: 'visible',
        height: '',
        padding: '',
        overflow: '',
      });
      Object.assign(lay.style, {
        opacity: '0',
        transform: 'translateX(20px)',
        position: 'absolute',
        width: '100%',
        top: '0',
        left: '0',
        pointerEvents: 'none',
        visibility: 'hidden',
        height: '0',
        padding: '0',
        overflow: 'hidden',
      });
    } else {
      Object.assign(sty.style, {
        opacity: '0',
        transform: 'translateX(-20px)',
        position: 'absolute',
        width: '100%',
        top: '0',
        left: '0',
        pointerEvents: 'none',
        visibility: 'hidden',
        height: '0',
        padding: '0',
        overflow: 'hidden',
      });
      Object.assign(lay.style, {
        opacity: '1',
        transform: 'translateX(0)',
        position: 'relative',
        pointerEvents: 'auto',
        visibility: 'visible',
        height: '',
        padding: '',
        overflow: '',
      });
    }
  }

  function renderContentArea() {
    const area = $contentArea();
    if (!area || !siData) {
      if (area) {
        area.classList.add('hidden');
        area.innerHTML = '';
      }
      return;
    }
    const show = siData.isText || siData.isImage || siData.isLink;
    if (!show) {
      area.classList.add('hidden');
      area.innerHTML = '';
      return;
    }
    area.classList.remove('hidden');
    let h = '';
    if (siData.isText)
      h += \`<div class="si-field-group"><label class="si-field-label">\${L.content?.textContentLabel || 'Text content'}</label><textarea class="si-field-input si-field-textarea" id="siFieldText" placeholder="\${L.content?.textContentPlaceholder || 'Edit text content...'}">\${esc(siData.textContent)}</textarea></div>\`;
    if (siData.isImage) {
      const imageSrc = esc(siData.src);
      h += \`<div class="si-field-group si-image-field"><label class="si-field-label">\${L.content?.imageSourceLabel || 'Image source'}</label>\`;
      h += \`<div class="si-image-preview-frame"><img id="siImagePreview" class="si-image-preview" src="\${imageSrc}" alt="" onerror="this.classList.add('si-image-preview-hidden')" /></div>\`;
      h += \`<div class="si-image-source-row"><input class="si-field-input si-image-source-input" id="siFieldSrc" type="text" value="\${imageSrc}" placeholder="\${L.content?.imageSourcePlaceholder || 'Edit image source URL'}">\`;
      h += \`<button type="button" class="si-image-upload-btn" id="siUploadImageBtn">\${L.content?.uploadImage || 'Upload'}</button>\`;
      h += \`<input type="file" id="siImageFileInput" accept="image/*" style="display:none"></div></div>\`;
    }
    if (siData.isLink)
      h += \`<div class="si-field-group"><label class="si-field-label">\${L.content?.linkUrlLabel || 'Link URL'}</label><input class="si-field-input" id="siFieldHref" type="text" value="\${esc(siData.href)}" placeholder="\${L.content?.linkUrlPlaceholder || 'Edit link URL'}"></div>\`;
    area.innerHTML = h;
    // Auto-resize textarea to fit content (max 5 lines)
    const autoResizeTextarea = (ta) => {
      if (!ta) return;
      ta.style.height = '32px';
      ta.style.overflowY = 'hidden';
      const maxH = 112; // 5 lines * 20px + 12px padding
      if (ta.scrollHeight > 32) {
        const newH = Math.min(ta.scrollHeight, maxH);
        ta.style.height = newH + 'px';
        ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden';
      }
    };
    const siTextarea = document.getElementById('siFieldText');
    if (siTextarea) {
      autoResizeTextarea(siTextarea);
      siTextarea.addEventListener('input', () => autoResizeTextarea(siTextarea));
    }
    const bindLive = (id, apply) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        if (siTarget) {
          apply(el.value);
          hl.scheduleRender();
          updateActionButton();
        }
      });
    };
    bindLive('siFieldText', (v) => {
      safeSetText(siTarget, v);
      showETB();
      updateETB();
      updateActionButton();
    });
    bindLive('siFieldSrc', (v) => {
      syncImageEditorSource(v);
    });
    bindLive('siFieldHref', (v) => {
      if ('href' in siTarget) siTarget.href = v;
      showETB();
      updateETB();
      updateActionButton();
    });
    // Image upload
    const imgUploadBtn = document.getElementById('siUploadImageBtn');
    const imgFileInput = document.getElementById('siImageFileInput');
    if (imgUploadBtn && imgFileInput) {
      imgUploadBtn.addEventListener('click', () => imgFileInput.click());
      imgFileInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file || !siTarget) return;

        if (siImagePreviewObjectUrl) URL.revokeObjectURL(siImagePreviewObjectUrl);
        siImagePreviewObjectUrl = URL.createObjectURL(file);
        const previousButtonText = imgUploadBtn.textContent;
        const preview = document.getElementById('siImagePreview');
        if (preview) {
          preview.src = siImagePreviewObjectUrl;
          preview.classList.remove('si-image-preview-hidden');
        }
        imgUploadBtn.disabled = true;
        imgUploadBtn.textContent = L.content?.uploading || 'Uploading...';
        try {
          const imgUrl = await requestImageUpload(file);
          syncImageEditorSource(imgUrl);
        } catch (err) {
          console.error('[HtmlEditor] image upload failed:', err);
          alert(L.content?.uploadFailed || 'Image upload failed. Please try again.');
        } finally {
          imgUploadBtn.disabled = false;
          imgUploadBtn.textContent = previousButtonText || L.content?.uploadImage || 'Upload';
          imgFileInput.value = '';
        }
      });
    }
    const txtEl = document.getElementById('siFieldText');
    if (txtEl)
      txtEl.addEventListener('input', () => {
        txtEl.style.height = 'auto';
        txtEl.style.height = Math.min(txtEl.scrollHeight, 200) + 'px';
      });
  }

  function renderStylePane() {
    const b = $paneStyle();
    if (!b || !siData) {
      if (b) b.innerHTML = '';
      return;
    }
    const S = siData.style;
    const px = (v) => parseFloat(v) || '';
    b.innerHTML = \`
      <div class="si-row"><div class="si-label">\${L.style?.colors || 'Colors'}</div><div class="si-grid">
        <div class="si-color-row"><input type="color" class="si-color-swatch" id="siColor" value="\${toHex(S.color)}"><input class="si-input" style="flex:1" id="siColorTxt" value="\${esc(S.color)}"></div>
        <div class="si-color-row"><input type="color" class="si-color-swatch" id="siBg" value="\${toHex(S.backgroundColor)}"><input class="si-input" style="flex:1" id="siBgTxt" value="\${esc(S.backgroundColor)}"></div>
      </div></div>
      <div class="si-row"><div class="si-label">\${L.style?.typography || 'Typography'}</div><div class="si-grid">
        <div><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.style?.fontSize || 'Font Size'}</div><input class="si-input" id="siFontSize" type="number" value="\${px(S.fontSize)}"></div>
        <div><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.style?.fontWeight || 'Font Weight'}</div><select class="si-select" id="siFontWeight">\${['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'].map((v) => \`<option\${S.fontWeight === v ? ' selected' : ''}>\${v}</option>\`).join('')}</select></div>
      </div><div style="margin-top:6px"><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.style?.fontStyle || 'Font Style'}</div><select class="si-select" id="siFontStyle">\${['normal', 'italic', 'oblique'].map((v) => \`<option\${S.fontStyle === v ? ' selected' : ''}>\${v}</option>\`).join('')}</select></div></div>
      <div class="si-row"><div class="si-label">\${L.style?.text || 'Text'}</div><div class="si-grid">
        <div><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.style?.align || 'Align'}</div><select class="si-select" id="siAlign">\${['left', 'center', 'right', 'justify'].map((v) => \`<option\${S.textAlign === v ? ' selected' : ''}>\${v}</option>\`).join('')}</select></div>
        <div><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.style?.decoration || 'Decoration'}</div><select class="si-select" id="siDecor">\${['none', 'underline', 'overline', 'line-through'].map((v) => \`<option\${(S.textDecoration || '').includes(v) ? ' selected' : ''}>\${v}</option>\`).join('')}</select></div>
      </div><div style="margin-top:6px"><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.style?.display || 'Display'}</div><select class="si-select" id="siDisplay">\${['block', 'inline', 'inline-block', 'flex', 'grid', 'none'].map((v) => \`<option\${S.display === v ? ' selected' : ''}>\${v}</option>\`).join('')}</select></div></div>
      <div class="si-row"><div class="si-label" style="cursor:pointer;user-select:none;display:flex;align-items:center;gap:4px" onclick="this.parentElement.querySelector('.si-other-body').classList.toggle('hidden');this.querySelector('.si-chevron').classList.toggle('si-chevron-open')"><span class="si-chevron" style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 4.5 6 7.5 9 4.5"/></svg></span>\${L.style?.other || 'Other'}</div><div class="si-other-body hidden"><div class="si-grid">
        <div><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.style?.objectFit || 'Object Fit'}</div><select class="si-select" id="siObjFit">\${['fill', 'contain', 'cover', 'none', 'scale-down'].map((v) => \`<option\${S.objectFit === v ? ' selected' : ''}>\${v}</option>\`).join('')}</select></div>
        <div><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.style?.opacity || 'Opacity'}</div><input class="si-input" id="siOp" type="number" min="0" max="1" step="0.1" value="\${S.opacity}"></div>
      </div></div></div>\`;
    bindStyleLive();
  }

  function renderLayoutPane() {
    const b = $paneLayout();
    if (!b || !siData) {
      if (b) b.innerHTML = '';
      return;
    }
    const S = siData.style;
    const px = (v) => parseFloat(v) || '';
    b.innerHTML = \`
      <div class="si-row"><div class="si-label">\${L.layout?.padding || 'Padding'}</div><div class="si-grid">
        <div><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.layout?.top || 'Top'}</div><input class="si-input" id="siPT" type="number" value="\${px(S.paddingTop)}"></div>
        <div><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.layout?.right || 'Right'}</div><input class="si-input" id="siPR" type="number" value="\${px(S.paddingRight)}"></div>
        <div><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.layout?.bottom || 'Bottom'}</div><input class="si-input" id="siPB" type="number" value="\${px(S.paddingBottom)}"></div>
        <div><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.layout?.left || 'Left'}</div><input class="si-input" id="siPL" type="number" value="\${px(S.paddingLeft)}"></div>
      </div></div>
      <div class="si-row"><div class="si-label">\${L.layout?.margin || 'Margin'}</div><div class="si-grid">
        <div><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.layout?.top || 'Top'}</div><input class="si-input" id="siMT" type="number" value="\${px(S.marginTop)}"></div>
        <div><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.layout?.right || 'Right'}</div><input class="si-input" id="siMR" type="number" value="\${px(S.marginRight)}"></div>
        <div><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.layout?.bottom || 'Bottom'}</div><input class="si-input" id="siMB" type="number" value="\${px(S.marginBottom)}"></div>
        <div><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.layout?.left || 'Left'}</div><input class="si-input" id="siML" type="number" value="\${px(S.marginLeft)}"></div>
      </div></div>
      <div class="si-row"><div class="si-label">\${L.layout?.size || 'Size'}</div><div class="si-grid">
        <div><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.layout?.width || 'Width'}</div><input class="si-input" id="siW" type="number" value="\${px(S.width)}"></div>
        <div><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.layout?.height || 'Height'}</div><input class="si-input" id="siH" type="number" value="\${px(S.height)}"></div>
      </div></div>
      <div class="si-row"><div class="si-label">\${L.layout?.border || 'Border'}</div><div class="si-grid">
        <div><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.layout?.borderWidth || 'Width'}</div><input class="si-input" id="siBW" type="number" value="\${px(S.borderWidth)}"></div>
        <div><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.layout?.borderRadius || 'Radius'}</div><input class="si-input" id="siBR" type="number" value="\${px(S.borderRadius)}"></div>
      </div><div style="margin-top:6px"><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">\${L.layout?.borderStyle || 'Style'}</div><select class="si-select" id="siBS">\${['none', 'solid', 'dashed', 'dotted', 'double'].map((v) => \`<option\${S.borderStyle === v ? ' selected' : ''}>\${v}</option>\`).join('')}</select></div></div>\`;
    bindLayoutLive();
  }

  // 颜色 swatch 与文本输入联动，避免 background 置空变黑
  function bindStyleLive() {
    const trackAndSet = (target, cp, val) => {
      if (!(cp in siModifiedInlineProps)) {
        siModifiedInlineProps[cp] = target.style.getPropertyValue(cp);
      }
      if (val) target.style.setProperty(cp, val, 'important');
      else target.style.removeProperty(cp);
    };
    const liveStyle = (id, prop, unit = '') => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        if (!siTarget) return;
        const cp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        trackAndSet(siTarget, cp, el.value ? el.value + unit : '');
        hl.scheduleRender();
        showETB();
        updateETB();
        updateActionButton();
      });
    };
    const liveColor = (swatchId, txtId, prop) => {
      const sw = document.getElementById(swatchId),
        tx = document.getElementById(txtId);
      if (sw)
        sw.addEventListener('input', () => {
          if (tx) tx.value = sw.value;
          if (siTarget) trackAndSet(siTarget, prop, sw.value);
          hl.scheduleRender();
          showETB();
          updateETB();
          updateActionButton();
        });
      if (tx)
        tx.addEventListener('input', () => {
          try {
            if (sw) sw.value = toHex(tx.value);
          } catch (e) {}
          if (siTarget) trackAndSet(siTarget, prop, tx.value);
          hl.scheduleRender();
          showETB();
          updateETB();
          updateActionButton();
        });
    };
    liveColor('siColor', 'siColorTxt', 'color');
    liveColor('siBg', 'siBgTxt', 'background-color');
    liveStyle('siFontSize', 'fontSize', 'px');
    liveStyle('siFontWeight', 'fontWeight');
    liveStyle('siFontStyle', 'fontStyle');
    liveStyle('siAlign', 'textAlign');
    liveStyle('siDecor', 'textDecoration');
    liveStyle('siDisplay', 'display');
    liveStyle('siObjFit', 'objectFit');
    liveStyle('siOp', 'opacity');
  }

  function bindLayoutLive() {
    const trackAndSet = (target, cp, val) => {
      if (!(cp in siModifiedInlineProps)) {
        siModifiedInlineProps[cp] = target.style.getPropertyValue(cp);
      }
      if (val) target.style.setProperty(cp, val, 'important');
      else target.style.removeProperty(cp);
    };
    const liveStyle = (id, prop, unit = '') => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        if (!siTarget) return;
        const cp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        trackAndSet(siTarget, cp, el.value ? el.value + unit : '');
        hl.scheduleRender();
        showETB();
        updateETB();
        updateActionButton();
      });
    };
    liveStyle('siPT', 'paddingTop', 'px');
    liveStyle('siPR', 'paddingRight', 'px');
    liveStyle('siPB', 'paddingBottom', 'px');
    liveStyle('siPL', 'paddingLeft', 'px');
    liveStyle('siMT', 'marginTop', 'px');
    liveStyle('siMR', 'marginRight', 'px');
    liveStyle('siMB', 'marginBottom', 'px');
    liveStyle('siML', 'marginLeft', 'px');
    liveStyle('siW', 'width', 'px');
    liveStyle('siH', 'height', 'px');
    liveStyle('siBW', 'borderWidth', 'px');
    liveStyle('siBR', 'borderRadius', 'px');
    liveStyle('siBS', 'borderStyle');
  }

  // 面板定位：依 right→left→below→above 优先级选择不溢出的位置
  const PANEL_W = 320,
    PANEL_MAX_H = Math.floor(window.innerHeight * 0.8),
    VP_MARGIN = 16,
    GAP = 8;
  function positionSI(el, keepPosition) {
    const p = $panel();
    if (!p) return;
    const r = toPageRect(el);
    if (!r) return;
    const vw = window.innerWidth,
      vh = window.innerHeight;
    // 重置高度约束后再读自然高度，防止缩小反馈循环
    p.style.removeProperty('max-height');
    const panelH = p.offsetHeight || PANEL_MAX_H;
    if (keepPosition) {
      hl.addExclusionRect(
        'control-panel',
        new DOMRect(parseFloat(p.style.left) || 0, parseFloat(p.style.top) || 0, PANEL_W, panelH),
      );
      return;
    }
    const centerY = () => {
      const y = r.top + r.height / 2 - panelH / 2;
      return Math.max(VP_MARGIN, Math.min(y, vh - VP_MARGIN - panelH));
    };
    const fits = (l, t) =>
      l >= VP_MARGIN &&
      l + PANEL_W <= vw - VP_MARGIN &&
      t >= VP_MARGIN &&
      t + panelH <= vh - VP_MARGIN;
    const candidates = [
      { left: r.right + GAP, top: centerY() },
      { left: r.left - PANEL_W - GAP, top: centerY() },
      {
        left: Math.max(VP_MARGIN, Math.min(r.left, vw - VP_MARGIN - PANEL_W)),
        top: r.bottom + GAP,
      },
      {
        left: Math.max(VP_MARGIN, Math.min(r.left, vw - VP_MARGIN - PANEL_W)),
        top: r.top - panelH - GAP,
      },
    ];
    let chosen = candidates.find((c) => fits(c.left, c.top));
    if (!chosen) {
      chosen = candidates[0];
      chosen.left = Math.max(VP_MARGIN, Math.min(chosen.left, vw - VP_MARGIN - PANEL_W));
      chosen.top = Math.max(VP_MARGIN, Math.min(chosen.top, vh - VP_MARGIN - panelH));
    }
    p.style.left = chosen.left + 'px';
    p.style.top = chosen.top + 'px';
    // 约束面板不超出视口底部
    const availH = vh - VP_MARGIN - chosen.top;
    if (availH < panelH) p.style.maxHeight = availH + 'px';
    requestAnimationFrame(() => {
      p.style.opacity = '1';
      p.style.transform = 'scale(1)';
    });
    hl.addExclusionRect('control-panel', new DOMRect(chosen.left, chosen.top, PANEL_W, panelH));
  }

  // ===== DomSelector =====
  let activeTarget = null,
    hoverTarget = null,
    pointerDown = false,
    isDirectEditing = false,
    removeEnterKeyListener = null;

  function onPointerOver(e) {
    if (mode !== 'edit') return;
    const c = e.target;
    if (!isElement(c) || isIgnored(c)) {
      hoverTarget = null;
      hl.setHoverTarget(null);
      return;
    }
    hoverTarget = c;
    hl.setHoverTarget(hoverTarget);
  }
  function onPointerOut(e) {
    if (mode !== 'edit') return;
    if (e.target && !isElement(e.target)) return;
    if (
      e.relatedTarget &&
      e.relatedTarget.nodeType &&
      document.documentElement.contains(e.relatedTarget)
    )
      return;
    hoverTarget = null;
    hl.setHoverTarget(null);
  }
  function findBestTarget(e) {
    var c = e.target;
    if (!isElement(c) || isIgnored(c)) return null;
    var tag = c.tagName;
    if (tag === 'IMG' || tag === 'VIDEO' || tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return c;
    if (hasEditableText(c)) return c;
    var elements = document.elementsFromPoint(e.clientX, e.clientY);
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (el === c || isIgnored(el)) continue;
      if (el.tagName === 'IMG' || el.tagName === 'VIDEO') return el;
    }
    return c;
  }

  function onPointerDown(e) {
    if (mode !== 'edit') return;

    try {
      var c = findBestTarget(e);
      if (!c) return;

      if (activeTarget && !isValidElement(activeTarget)) {
        console.warn('[onPointerDown] activeTarget is stale, forcing clear');
        forceClearState();
      }

      e.preventDefault();
      e.stopPropagation();
      selectElement(c, e);
    } catch (err) {
      console.error('[onPointerDown] error:', err);
      forceClearState();
    }
  }
  function onDocClick(e) {
    if (mode !== 'edit') return;
    const c = e.target;
    if (!isElement(c) || isIgnored(c)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function selectElement(el, mouseEvent) {
    if (!isValidElement(el)) {
      console.warn('[selectElement] invalid element, clearing state');
      forceClearState();
      return;
    }
    
    if (activeTarget && !isValidElement(activeTarget)) {
      console.warn('[selectElement] activeTarget is stale, clearing');
      forceClearState();
    }
    
    // Same element clicked again: try to drill through to a deeper/behind element
    if (activeTarget && el === activeTarget) {
      if (mouseEvent) {
        const x = mouseEvent.clientX, y = mouseEvent.clientY;
        const elements = document.elementsFromPoint(x, y);
        for (let i = 0; i < elements.length; i++) {
          const candidate = elements[i];
          if (candidate === el || isIgnored(candidate)) continue;
          // Drill into child or select sibling/ancestor behind the overlay
          selectElement(candidate);
          return;
        }
      }
      if (isDirectEditable(el)) {
        enterDirectEdit(el);
      }
      return;
    }
    // 点击其他区域：先丢弃未确认的修改，再清理状态
    if (siTarget && siOrigData) {
      discardSI();
    }
    // 清理选择器状态，允许重新选择
    activeTarget = null;
    hoverTarget = null;
    hl.setActiveTarget(null);
    hl.setHoverTarget(null);
    exitDirectEdit();
    removeEnterKeyListener?.();
    removeEnterKeyListener = null;
    pointerDown = false;
    closeSI();
    
    // 如果点击的是有效元素，继续打开面板
    if (el) {
      activeTarget = el;
      hoverTarget = el;
      hl.setActiveTarget(activeTarget);
      hl.setHoverTarget(hoverTarget);
      if (isDirectEditable(el)) setupEnterKeyListener();
      openSI(el);
      showETB();
      renderComments();
    }
  }
  
  // 强制清理所有状态（当 DOM 发生变化时使用）
  function forceClearState() {
    console.log('[forceClearState] forcing clear all states');
    
    try {
      exitDirectEdit();
    } catch (e) {}
    
    try {
      removeEnterKeyListener?.();
    } catch (e) {}
    removeEnterKeyListener = null;
    
    pointerDown = false;
    
    // 先处理 discard（需要 siTarget/siOrigData），再清理状态变量
    if (siTarget && siOrigData) {
      try {
        discardSI();
      } catch (e) {
        console.warn('[forceClearState] discardSI failed:', e);
      }
    } else {
      closeSI();
    }
    
    activeTarget = null;
    hoverTarget = null;
    siTarget = null;
    siData = null;
    siOrigData = null;
    siPanelOpenData = null;
    siOrigInlineStyle = null;
    
    try {
      hl.setActiveTarget(null);
      hl.setHoverTarget(null);
    } catch (e) {}
    
    try {
      const p = $panel();
      if (p) {
        p.classList.add('hidden');
        p.style.display = 'none';
      }
      
      const contentArea = $contentArea();
      if (contentArea) {
        contentArea.classList.add('hidden');
      }
    } catch (e) {}
  }

  function deselectElement() {
    exitDirectEdit();
    removeEnterKeyListener?.();
    removeEnterKeyListener = null;
    pointerDown = false;
    activeTarget = null;
    hoverTarget = null;
    hl.setActiveTarget(null);
    hl.setHoverTarget(null);
    // 释放鼠标：丢弃未确认的修改
    if (siTarget && siOrigData) {
      discardSI();
      return;
    }
    closeSI();
  }

  function setupEnterKeyListener() {
    const handler = (e) => {
      if (e.key !== 'Enter' || isDirectEditing || !activeTarget) return;
      if (!isDirectEditable(activeTarget)) return;
      e.preventDefault();
      e.stopPropagation();
      enterDirectEdit(activeTarget);
    };
    document.addEventListener('keydown', handler, true);
    removeEnterKeyListener = () => {
      document.removeEventListener('keydown', handler, true);
    };
  }

  function enterDirectEdit(el) {
    if (isDirectEditing) return;
    // Safety guard: never set contenteditable on container elements
    if (!isDirectEditable(el)) return;
    isDirectEditing = true;
    el.setAttribute('contenteditable', 'true');
    el.focus();
    setTimeout(() => {
      try {
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (e) {}
    }, 0);
    const onBlur = () => exitDirectEdit();
    const onKey = (e) => {
      if (e.key === 'Escape') exitDirectEdit();
    };
    const onInput = () => hl.scheduleRender();
    el.addEventListener('blur', onBlur, { once: true });
    el.addEventListener('keydown', onKey);
    el.addEventListener('input', onInput);
    el._editClean = () => {
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('input', onInput);
    };
  }

  function exitDirectEdit() {
    if (!isDirectEditing || !activeTarget) {
      isDirectEditing = false;
      return;
    }
    isDirectEditing = false;
    activeTarget.removeAttribute('contenteditable');
    if (activeTarget._editClean) {
      activeTarget._editClean();
      delete activeTarget._editClean;
    }
  }

  function handleUndoRedo(e) {
    const k = e.key.toLowerCase();
    const isU = (e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey;
    const isR = (e.ctrlKey || e.metaKey) && ((k === 'z' && e.shiftKey) || k === 'y');
    if (!isU && !isR) return;
    const t = e.target;
    if (
      isElement(t) &&
      (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    if (!editHistory) return;
    let r = null;
    if (isU) {
      r = editHistory.undo();
      hl.scheduleRender();
    } else {
      r = editHistory.redo();
      hl.scheduleRender();
    }
    if (r?.target && iframeContains(r.target)) {
      r.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      hl.setActiveTarget(r.target);
      setTimeout(() => hl.setActiveTarget(null), 1500);
    }
    updateETB();
    renderComments();
  }

  function handleDelete(e) {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (isDirectEditing || !activeTarget) return;
    const t = e.target;
    if (
      isElement(t) &&
      (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)
    )
      return;
    if (!isDeletable(activeTarget)) return;
    e.preventDefault();
    e.stopPropagation();
    const parent = activeTarget.parentElement;
    if (!parent) return;
    const next = activeTarget.nextSibling;
    const data = getElementData(activeTarget);
    const el = activeTarget;
    // 删除元素前：丢弃未确认的修改
    if (siTarget && siOrigData) {
      discardSI();
      return;
    }
    closeSI();
    exitDirectEdit();
    removeEnterKeyListener?.();
    removeEnterKeyListener = null;
    parent.removeChild(el);
    if (editHistory) {
      editHistory.addEdit({
        target: el,
        targetData: data,
        changes: { deleted: { parent, nextSibling: next, outerHTML: el.outerHTML } },
        screenshot: null,
      });
    }
    pointerDown = false;
    activeTarget = null;
    hoverTarget = null;
    hl.setActiveTarget(null);
    hl.setHoverTarget(null);
    showETB();
    updateETB();
    renderComments();
  }

  function handleArrowNav(e) {
    if (isDirectEditing || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key))
      return;
    const t = e.target;
    if (
      isElement(t) &&
      (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)
    )
      return;
    if (!activeTarget) return;
    e.preventDefault();
    e.stopPropagation();
    const dir = {
      ArrowUp: 'previousElementSibling',
      ArrowDown: 'nextElementSibling',
      ArrowLeft: 'parentElement',
      ArrowRight: 'firstElementChild',
    }[e.key];
    let next = activeTarget[dir];
    if (!next && dir === 'nextElementSibling') next = activeTarget.parentElement;
    if (!next && dir === 'previousElementSibling') next = activeTarget.parentElement;
    if (next && !isIgnored(next)) selectElement(next);
  }

  function handleEscape(e) {
    if (e.key !== 'Escape') return;
    if (isDirectEditing) {
      exitDirectEdit();
      return;
    }
    if (activeTarget) {
      deselectElement();
      return;
    }
    const t = e.target;
    if (
      isElement(t) &&
      (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)
    )
      return;
    if (!editHistory || !editHistory.hasEdits()) setMode('preview');
  }

  function handleScrollOutOfView() {
    if (!activeTarget || !pointerDown || isDirectEditing) return;
    if (isScrolledOutOfView(activeTarget)) {
      // 滚动导致元素不可见：丢弃未确认的修改
      if (siTarget && siOrigData) {
        discardSI();
        return;
      }
      closeSI();
      exitDirectEdit();
      removeEnterKeyListener?.();
      removeEnterKeyListener = null;
      pointerDown = false;
      activeTarget = null;
      hoverTarget = null;
      hl.setActiveTarget(null);
      hl.setHoverTarget(null);
    }
  }

  // ===== EditCards =====
  function renderCards() {
    const box = document.getElementById('ecards');
    if (!box || !editHistory) return;
    const edits = editHistory.getActiveEdits();
    if (edits.length === 0) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = edits
      .map((e, i) => {
        const d = e.targetData || {};
        const del = e.changes.deleted ? ' del' : '';
        const desc =
          e.changes.comment?.modified ||
          e.changes.textContent?.modified ||
          (e.changes.deleted
            ? L.cards?.deleted || 'Deleted'
            : L.cards?.styleChange || 'Style change');
        return \`<div class="ecard" data-idx="\${i}"><span class="ecard-n">\${i + 1}</span><div class="ecard-i"><div class="ecard-t\${del}">&lt;\${d.tagName || '?'}&gt;</div><div class="ecard-d">\${esc(String(desc).slice(0, 60))}</div></div></div>\`;
      })
      .join('');
  }
  let cardsVisible = false;

  // ===== 模式切换 =====
  function setMode(newMode) {
    mode = newMode;
    if (mode === 'edit') {
      bindEvents();
      document.body.style.cursor = 'crosshair';
    } else {
      document.body.style.cursor = '';
      deselectElement();
      hl.clear();
      hideETB();
    }
    window.parent.postMessage({ type: 'MODE_CHANGED', data: { mode } }, '*');
  }

  // ===== 事件绑定 =====
  let eventsBound = false;
  function bindEvents() {
    if (eventsBound) return;
    document.addEventListener('pointerover', onPointerOver, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerout', onPointerOut, true);
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', handleUndoRedo, true);
    document.addEventListener('keydown', handleDelete, true);
    document.addEventListener('keydown', handleArrowNav, true);
    document.addEventListener('keydown', handleEscape, true);
    window.addEventListener('scroll', handleScrollOutOfView, { passive: true });
    eventsBound = true;
  }

  // ===== 全局 API =====
  window.__BA_Editor__ = {
    setMode,
    getMode: () => mode,
    getCurrentElement: () => activeTarget,
    selectElement,
    deselectElement,
    openSI,
    closeSI,
    saveSI,
    discardSI,
    setSITab,
    hl,
    editHistory,
  };

  // 必须在任何编辑前捕获
  const cleanOriginalHtml = getCleanBodyHtml();

  // id 优先，其次 tag + nth-of-type 路径
  function getCSSSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el === document.body) return 'body';

    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && cur.nodeType === 1) {
      if (cur.id) {
        parts.unshift('#' + cur.id);
        break; // id 唯一，不再往上追溯
      }
      const tag = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(cur) + 1;
          parts.unshift(tag + ':nth-of-type(' + idx + ')');
        } else {
          parts.unshift(tag);
        }
      } else {
        parts.unshift(tag);
      }
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  // 将 DOM 元素引用转换为可跨 iframe postMessage 的纯对象
  function serializeEdit(edit) {
    const { target, changes, targetData } = edit;
    const selector = target ? getCSSSelector(target) : '';

    // 回退 clone 到编辑前状态，重建 originalOuterHtml
    let originalOuterHtml = '';
    let currentOuterHtml = '';
    if (target) {
      currentOuterHtml = target.outerHTML;
      if (changes.src?.modified && target.tagName === 'IMG') {
        const currentClone = target.cloneNode(true);
        applyImageSourceToTarget(currentClone, changes.src.modified);
        currentOuterHtml = currentClone.outerHTML;
      }
      const clone = target.cloneNode(true);
      if (changes.textContent) {
        // clone.textContent = ... 会清除所有子元素，只还原直接文本节点
        const textNode = Array.from(clone.childNodes).find((n) => n.nodeType === 3);
        if (textNode) {
          textNode.textContent = changes.textContent.original;
        }
      }
      if (changes.style) {
        for (const [prop, val] of Object.entries(changes.style)) {
          clone.style[prop] = val.original || '';
        }
      }
      originalOuterHtml = clone.outerHTML;
    }

    const serialized = {
      selector,
      tagName: target ? target.tagName.toLowerCase() : targetData?.tagName || '',
      originalOuterHtml,
      currentOuterHtml,
      srcLoc: target?.getAttribute('data-loc') || 'index.html',
      changes: {},
    };

    if (changes.textContent) {
      serialized.changes.textContent = {
        original: changes.textContent.original,
        modified: changes.textContent.modified,
      };
    }

    if (changes.style && Object.keys(changes.style).length > 0) {
      const styleChanges = {};
      for (const [prop, val] of Object.entries(changes.style)) {
        // 两边都是默认值 → no-op
        if (isCssDefault(val.original) && isCssDefault(val.modified)) continue;
        // 归一化后相同 → 跳过
        if ((val.original || '').trim() === (val.modified || '').trim()) continue;
        styleChanges[prop] = { original: val.original || '', modified: val.modified || '' };
      }
      if (Object.keys(styleChanges).length > 0) {
        serialized.changes.style = styleChanges;
      }
    }

    if (changes.src) {
      serialized.changes.src = {
        original: changes.src.original,
        modified: changes.src.modified,
      };
    }

    if (changes.href) {
      serialized.changes.href = {
        original: changes.href.original,
        modified: changes.href.modified,
      };
    }

    if (changes.deleted) {
      const parentSelector = changes.deleted.parent ? getCSSSelector(changes.deleted.parent) : '';
      serialized.changes.deleted = {
        parentSelector,
      };
    }

    // 用户标注，与 changes 同级
    if (changes.comment) {
      serialized.changes.comment = {
        original: changes.comment.original || '',
        modified: changes.comment.modified || '',
      };
    }

    // cleanOriginalHtml 与 originalOuterHtml 同为浏览器序列化，indexOf 可靠定位
    let position = null;
    if (originalOuterHtml && cleanOriginalHtml) {
      const idx = cleanOriginalHtml.indexOf(originalOuterHtml);
      if (idx !== -1) {
        let line = 1,
          col = 1;
        for (let i = 0; i < idx; i++) {
          if (cleanOriginalHtml.charCodeAt(i) === 10) {
            line++;
            col = 1;
          } else col++;
        }
        position = { charStart: idx, charEnd: idx + originalOuterHtml.length, line, col };
      }
    }
    serialized.position = position;

    return serialized;
  }

  window.toggleCards = () => {
    const box = document.getElementById('ecards');
    if (!box) return;
    cardsVisible = !cardsVisible;
    if (cardsVisible) {
      renderCards();
      box.classList.remove('hidden');
    } else {
      box.classList.add('hidden');
    }
  };
  window.doUndo = () => {
    if (!editHistory) return;
    editHistory.undo();
    hl.scheduleRender();
    updateETB();
    renderComments();
  };
  window.doRedo = () => {
    if (!editHistory) return;
    editHistory.redo();
    hl.scheduleRender();
    updateETB();
    renderComments();
  };
  window.doDiscard = () => {
    if (!editHistory) return;
    if (siTarget && siOrigData) {
      discardSI();
    }
    exitDirectEdit();
    removeEnterKeyListener?.();
    removeEnterKeyListener = null;
    pointerDown = false;
    activeTarget = null;
    hoverTarget = null;
    editHistory.clear();
    hl.clear();
    updateETB();
    renderComments();
    hideETB();
    window.parent.postMessage(
      {
        type: 'EDIT_STATE_CHANGE',
        data: { hasUnsavedChanges: false, editCount: 0, canUndo: false, canRedo: false },
      },
      '*',
    );
  };
  window.doApply = () => {
    if (!editHistory) return;
    if (siTarget && siOrigData && hasChanges()) {
      autoSaveSI();
    }
    closeSI();
    const activeEdits = editHistory.getActiveEdits();
    const domChanges = activeEdits.map(serializeEdit);
    window.parent.postMessage(
      { type: 'HTML_CHANGED', data: { html: getCleanBodyHtml(), domChanges } },
      '*',
    );
  };
  window.setSITab = (tab) => setSITab(tab);
  window.confirmSI = () => confirmSI();
  window.saveSI = () => saveSI();
  window.discardSI = () => discardSI();

  // ===== EditHistory 变更监听 =====
  if (editHistory) {
    editHistory.onChange(() => {
      const edits = editHistory.getActiveEdits();
      window.parent.postMessage(
        {
          type: 'EDIT_STATE_CHANGE',
          data: {
            hasUnsavedChanges: editHistory.hasEdits(),
            editCount: edits.length,
            canUndo: editHistory.canUndo(),
            canRedo: editHistory.canRedo(),
          },
        },
        '*',
      );
    });
  }

  // ===== 初始化 =====
  window.addEventListener('resize', () => hl.scheduleRender());

  window.addEventListener('message', (event) => {
    const { type, data } = event.data || {};
    switch (type) {
      case 'INIT':
        if (data?.mode) setMode(data.mode);
        break;
      case 'SET_MODE':
        if (data?.mode) setMode(data.mode);
        break;
      case 'SET_DEVICE':
        break;
      case 'SET_APPLY_LOADING': {
        const btn = document.getElementById('appBtn');
        if (!btn) break;
        if (data?.loading) {
          btn.setAttribute('disabled', 'disabled');
          btn.classList.add('b-app-loading');
          btn.textContent = L.applyingBtn || 'Applying...';
        } else {
          btn.removeAttribute('disabled');
          btn.classList.remove('b-app-loading');
          btn.textContent = L.applyBtn || 'Apply';
        }
        break;
      }
      case 'IMAGE_UPLOAD_RESULT': {
        const requestId = data?.requestId;
        const pending = requestId ? imageUploadRequests.get(requestId) : null;
        if (!pending) break;
        imageUploadRequests.delete(requestId);
        if (data?.success && data?.imgUrl) {
          pending.resolve(data.imgUrl);
        } else {
          pending.reject(new Error(data?.error || 'image upload failed'));
        }
        break;
      }
    }
  });

  console.log('[Editor] Initializer complete (1:1 replica)');
})();
`;function he(l,p,d){try{l.contentWindow?.postMessage({type:p,data:d},"*")}catch{}}function kn(l){const p=d=>{d.data?.type&&l(d.data)};return window.addEventListener("message",p),()=>{window.removeEventListener("message",p)}}var s=He(Oe(),1);Re();Fe();Ze();Pe();gn();var n=He(ze(),1),Ln={ALLOWED_TAGS:["p","div","span","h1","h2","h3","h4","h5","h6","br","hr","strong","b","em","i","u","strike","del","a","img","table","thead","tbody","tr","td","th","ul","ol","li","blockquote","code","pre","sup","sub","small","mark","abbr","cite","dfn","kbd","samp","var","time","address","article","aside","figcaption","figure","footer","header","main","nav","section","details","summary","svg","path","circle","rect","line","polyline","polygon","ellipse","g","text","tspan","defs","use","symbol","view","linearGradient","stop","style","script","noscript","iframe"],ALLOWED_ATTR:["href","target","rel","title","alt","src","width","height","class","id","style","data-*","role","aria-*","lang","dir","cite","datetime","name","value","type","start","reversed","colspan","rowspan","headers","scope","d","fill","stroke","stroke-width","viewBox","xmlns","x","y","cx","cy","r","rx","ry","x1","y1","x2","y2","points","transform","clip-path","mask","filter","opacity","fill-opacity","stroke-opacity","stroke-linecap","stroke-linejoin","stroke-dasharray","stroke-dashoffset","font-size","font-family","font-weight","text-anchor","dominant-baseline","xml:space","preserveAspectRatio","onclick","ondblclick","onmousedown","onmouseup","onmouseover","onmousemove","onmouseout","onkeydown","onkeypress","onkeyup","onfocus","onblur","onchange","onsubmit","onreset","onselect","onload","onerror","onresize","onscroll","onpageshow","onpagehide"],ALLOWED_URI_REGEXP:/^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|xxx|sms|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,FORCE_BODY:!0,SANITIZE_DOM:!0,ALLOW_DATA_ATTR:!0,USE_PROFILES:{html:!0,svg:!0,svgFilters:!0}};function Dn(l,p,d="Preview"){return`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${d}</title>
  <style></style>
  ${p?`<style>${p}</style>`:""}
</head>
<body>
  ${l}
</body>
</html>`}function An(){return function(p,d){let m=null;return function(...h){m&&clearTimeout(m),m=setTimeout(()=>p(...h),d)}}}async function _n(l,p,d){const m=await l.arrayBuffer(),h=l.type||"image/png";if(h&&!hn.includes(h))throw new Error(`unsupported image type: ${h}`);const w=new Blob([m],{type:h}),C=new File([w],p||"image.png",{type:h}),t=await d(),u=(await un(C,void 0,t?{baseUrl:t.url,password:t.password}:void 0))?.data?.fileUrl;if(!u)throw new Error("image upload response missing fileUrl");return u}function Hn(){return(0,n.jsxs)("svg",{className:"animate-spin h-6 w-6 text-zinc-400",xmlns:"http://www.w3.org/2000/svg",fill:"none",viewBox:"0 0 24 24",children:[(0,n.jsx)("circle",{className:"opacity-25",cx:"12",cy:"12",r:"10",stroke:"currentColor",strokeWidth:"4"}),(0,n.jsx)("path",{className:"opacity-75",fill:"currentColor",d:"M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"})]})}function Zn(l){const{html:p="",src:d,className:m,style:h,enableSanitize:w=!1,sanitizeConfig:C,iframeStyle:t,iframeClassName:u,customStyles:S,onLoad:A,onError:I,trackingContext:P=xn,showLoading:me=!0,loadingComponent:f,title:N="Preview",sandbox:O,editable:y=!1,deviceType:fe="mobile",onModeChange:ie,onDeviceChange:re,onPublish:oe,onEditStateChange:ae,onHtmlChange:ye,onDomChanges:_,applyLoading:se=!1}=l,{t:o}=Be("webBuilder"),{getGatewayInfoForUpload:Q}=Ne(),[le,W]=(0,s.useState)(!0),[xe,F]=(0,s.useState)(!1),[be,V]=(0,s.useState)(""),[ce,k]=(0,s.useState)(y?"edit":"preview"),[G,we]=(0,s.useState)(fe),[ve,Te]=(0,s.useState)({hasUnsavedChanges:!1,editCount:0,canUndo:!1,canRedo:!1}),q=(0,s.useRef)(null),ee=(0,s.useRef)(void 0),z=(0,s.useRef)(null),L=(0,s.useRef)({...P,protocol:d?.startsWith("file://")?"file":"http",hasCustomStyles:!!S});L.current={...P,protocol:d?.startsWith("file://")?"file":"http",hasCustomStyles:!!S};const D=(0,s.useCallback)(()=>q,[]),K=(0,s.useRef)(new Map);(0,s.useEffect)(()=>{y||K.current.clear()},[y]),(0,s.useEffect)(()=>()=>{ee.current?.(),ee.current=void 0},[]);const M=(0,s.useMemo)(()=>{if(!w)return p;try{const c={...Ln,...C};return mn.sanitize(p,c)}catch(c){return I?.(c),F(!0),V("HTML sanitization failed."),""}},[p,w,C,I]),Y=(0,s.useMemo)(()=>{if(!y)return"";const c={describeChangePlaceholder:o("htmlEditor.editorDescribePlaceholder"),undoTitle:o("htmlEditor.editorUndo"),redoTitle:o("htmlEditor.editorRedo"),discardBtn:o("htmlEditor.editorDiscard"),applyBtn:o("htmlEditor.editorApply"),applyingBtn:o("htmlEditor.editorApplying"),styleTab:o("htmlEditor.editorStyleTab"),layoutTab:o("htmlEditor.editorLayoutTab"),closeTitle:o("action.close",{ns:"common"}),saveAndCloseTitle:o("htmlEditor.editorSaveAndClose"),editorConfirm:o("htmlEditor.editorConfirm"),content:{textContentLabel:o("htmlEditor.editorTextLabel"),textContentPlaceholder:o("htmlEditor.editorTextPlaceholder"),imageSourceLabel:o("htmlEditor.editorImageLabel"),imageSourcePlaceholder:"https://",linkUrlLabel:o("htmlEditor.editorLinkLabel"),linkUrlPlaceholder:"https://"},style:{colors:o("htmlEditor.editorColors"),typography:o("htmlEditor.editorTypography"),fontSize:o("htmlEditor.editorFontSize"),fontWeight:o("htmlEditor.editorFontWeight"),fontStyle:o("htmlEditor.editorFontStyle"),text:o("htmlEditor.editorTextLabel"),align:o("htmlEditor.editorTextAlign"),decoration:o("htmlEditor.editorDecoration"),display:o("htmlEditor.editorDisplay"),other:o("htmlEditor.editorOther"),objectFit:o("htmlEditor.editorObjectFit"),opacity:o("htmlEditor.editorOpacity")},layout:{padding:o("htmlEditor.editorPadding"),margin:o("htmlEditor.editorMargin"),size:o("htmlEditor.editorSize"),border:o("htmlEditor.editorBorder"),top:o("htmlEditor.editorTop"),right:o("htmlEditor.editorRight"),bottom:o("htmlEditor.editorBottom"),left:o("htmlEditor.editorLeft"),width:o("htmlEditor.editorWidth"),height:o("htmlEditor.editorHeight"),borderWidth:o("htmlEditor.editorBorderWidth"),borderRadius:o("htmlEditor.editorBorderRadius"),borderStyle:o("htmlEditor.editorBorderStyle")},cards:{deleted:o("htmlEditor.editorCardDeleted"),styleChange:o("htmlEditor.editorCardStyleChange")}};return`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${Sn}</style>
</head>
<body>
  ${M}

  <!-- Canvas overlay -->
  <canvas id="hlCanvas" aria-hidden="true"></canvas>

  <!-- Bottom toolbar -->
  <div class="etb-wrap hidden" id="etbWrap">
    <div class="etb" onmousedown="event.stopPropagation()">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="badge" id="badgeBtn" onclick="toggleCards()">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M7.529 7.529c.188-.189.471-.248.719-.148l6.666 2.666a.667.667 0 01.02 1.239l-2.599 1.027-1.027 2.599a.667.667 0 01-1.238-.02L7.404 8.225a.667.667 0 01.125-.696zM1.333 12.667a.667.667 0 011.334 0c0 .177.07.346.195.472.126.125.295.195.472.195a.667.667 0 010 1.333 2 2 0 01-2-2zM7.333 13.333a.667.667 0 010 1.334H6a.667.667 0 010-1.334h1.333zM10.663 12.863l.518-1.308.028-.063a.667.667 0 01.347-.312l1.308-.518-3.666-1.466 1.466 3.666zM1.333 10V9.333a.667.667 0 011.334 0V10a.667.667 0 01-1.334 0zM13.333 7.333V6a.667.667 0 011.334 0v1.333a.667.667 0 01-1.334 0zM1.333 6.667V6a.667.667 0 011.334 0v.667a.667.667 0 01-1.334 0zM1.333 3.333c0-.53.211-1.039.586-1.414A2 2 0 013.333 1.333a.667.667 0 010 1.334c-.177 0-.346.07-.471.195a.667.667 0 00-.196.471.667.667 0 01-1.333 0zM13.333 3.333c0-.177-.07-.346-.195-.471a.667.667 0 00-.472-.196.667.667 0 010-1.333 2 2 0 012 2 .667.667 0 01-1.333 0zM6.667 1.333a.667.667 0 010 1.334H6a.667.667 0 010-1.334h.667zM10 1.333a.667.667 0 010 1.334h-.667a.667.667 0 010-1.334H10z"/></svg>
          <span class="badge-n" id="badgeN">0</span>
        </button>
      </div>
      <div class="ab">
        <button class="b-dis" id="disBtn" disabled onclick="doDiscard()">${c.discardBtn}</button>
        <button class="b-app" id="appBtn" disabled onclick="doApply()">${c.applyBtn}</button>
      </div>
      <div class="ecards hidden" id="ecards"></div>
    </div>
  </div>

  <!-- SelectorInput panel -->
  <div class="si-overlay" id="siOverlay">
    <div class="si-panel hidden" id="siPanel" onmousedown="event.stopPropagation()">
      <div class="si-header-wrap">
        <div class="si-comment-row">
          <div class="si-comment-wrap">
            <textarea class="si-comment" id="siComment" rows="1" placeholder="${c.describeChangePlaceholder}"></textarea>
          </div>
          <div class="si-panel-actions">
            <button class="si-confirm-btn" id="siConfirmBtn" onclick="confirmSI()">${c.editorConfirm}</button>
            <button class="si-close-btn" id="siCloseBtn" title="${c.closeTitle}">
              <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="11" y2="11"/><line x1="11" y1="1" x2="1" y2="11"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div class="si-content-area hidden" id="siContentArea"></div>
      <div class="si-tabs">
        <button class="si-tab active" id="siTabStyle" onclick="setSITab('styles')">${c.styleTab}</button>
        <button class="si-tab" id="siTabLayout" onclick="setSITab('spacing')">${c.layoutTab}</button>
      </div>
      <div class="si-body-wrap">
        <div class="si-body-pane" id="siPaneStyle"></div>
        <div class="si-body-pane" id="siPaneLayout"></div>
      </div>
    </div>
  </div>

  <!-- Comment SVG + Container -->
  <svg id="cmSvg" style="position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483643"></svg>
  <div id="cmBox" style="position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483644"></div>

  <script>${Cn}<\/script>
  <script>window.__BA_EDITOR_LOC__ = ${JSON.stringify(c)};<\/script>
  <script>${In}<\/script>
</body>
</html>`},[y,M,o]);(0,s.useEffect)(()=>{(d||Y||M)&&(z.current=performance.now())},[d,Y,M]);const de=(0,s.useMemo)(()=>{if(!d)return y?Y:Dn(M,S,N)},[d,y,Y,M,S,N]),Ee=(0,s.useCallback)(()=>{setTimeout(()=>{W(!1),A?.();const c=performance.now(),g=z.current?Math.round(c-z.current):0;ge("accio_website.html_editor_load",{...L.current,editable:String(y),loadTimeMs:String(g)});const T=D().current;if(ee.current?.(),ee.current=vn(T),y&&T){T.contentWindow.__BA_debounce__=An(),window.editorIframe=T;const x=window;if(x.phoenixAPI?.opener?.httpRequest){const $=T.contentWindow;$.phoenixAPI={opener:{httpRequest:x.phoenixAPI.opener.httpRequest}};const E=`
            if (!window.__fetch_wrapped__) {
              window.__fetch_wrapped__ = true;
              const originalFetch = window.fetch;
              window.fetch = function(url, options) {
                const urlString = typeof url === 'string' ? url : url instanceof URL ? url.toString() : '';
                if (urlString.startsWith('http://') || urlString.startsWith('https://')) {
                  return window.phoenixAPI.opener.httpRequest(urlString, {
                    method: options?.method || 'GET',
                    headers: options?.headers,
                    body: options?.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : null,
                  }).then((result) => {
                    if (!result.success) {
                      throw new Error(result.error || 'Request failed');
                    }
                    return {
                      ok: result.status >= 200 && result.status < 300,
                      status: result.status,
                      json: () => Promise.resolve(result.data),
                      text: () => Promise.resolve(typeof result.data === 'string' ? result.data : JSON.stringify(result.data)),
                    };
                  }).catch((err) => {
                    console.error('[Iframe] Request failed:', err);
                    throw err;
                  });
                }
                return originalFetch.apply(this, arguments);
              };
            }
          `;T.contentWindow.__injectFetchWrapper=E,T.contentWindow?.eval(E)}he(T,"INIT",{mode:ce,device:G})}},500)},[y,D,ce,G,A]),Se=(0,s.useCallback)(()=>{W(!1),F(!0);const c="Failed to load preview.";V(c),I?.(new Error(c)),ge("accio_website.html_editor_error",{...L.current,editable:String(y),errorType:"load_failed"})},[I,y]);(0,s.useEffect)(()=>{if(y)return kn(c=>{switch(c.type){case"EDIT_STATE_CHANGE":{const g=c.data;Te(g),ae?.(g),g.editCount===0&&K.current.clear();break}case"HTML_CHANGED":{const g=c.data,T=g.html;let x=g.domChanges;const $=Array.isArray(x)?x.length:0;if(Je("accio_website.html_apply_clk",{...L.current,changeCount:String($),hasUnsavedChanges:String(ve.hasUnsavedChanges)}),Array.isArray(x)){const E=new Map;x.forEach(e=>{const a=e.srcLoc||e.selector||"unknown";if(!E.has(a))E.set(a,{...e});else{const i=E.get(a),r={...i,currentOuterHtml:e.currentOuterHtml,changes:{...i.changes}};e.changes.textContent&&(r.changes.textContent={original:i.changes.textContent?.original||e.changes.textContent.original,modified:e.changes.textContent.modified}),e.changes.style&&(r.changes.style={...i.changes.style},Object.entries(e.changes.style).forEach(([b,B])=>{r.changes.style[b]={original:i.changes.style?.[b]?.original||B.original,modified:B.modified}})),e.changes.comment&&(r.changes.comment={original:i.changes.comment?.original||e.changes.comment.original,modified:e.changes.comment.modified}),e.changes.src&&(r.changes.src={original:i.changes.src?.original||e.changes.src.original,modified:e.changes.src.modified}),e.changes.href&&(r.changes.href={original:i.changes.href?.original||e.changes.href.original,modified:e.changes.href.modified}),e.changes.deleted&&(r.changes.deleted=e.changes.deleted),E.set(a,r)}}),x=Array.from(E.values()).map(e=>{const a=e.srcLoc||e.selector||"unknown";if(!K.current.has(a)){const b={};e.changes.textContent&&(b.textContent=e.changes.textContent.original),e.changes.style&&(b.style={},Object.entries(e.changes.style).forEach(([B,X])=>{b.style[B]=X.original})),K.current.set(a,b)}const i=K.current.get(a),r={...e,changes:{...e.changes}};if(r.changes.textContent&&i.textContent!==void 0&&(r.changes.textContent={original:i.textContent,modified:r.changes.textContent.modified}),r.changes.style&&i.style){const b={};Object.entries(r.changes.style).forEach(([B,X])=>{const J=i.style[B];b[B]={original:J!==void 0?J:X.original,modified:X.modified}}),r.changes.style=b}return r})}_&&_(Array.isArray(x)?x:[],T),ye?.(T),oe?.();break}case"MODE_CHANGED":{const{mode:g}=c.data;k(g),ie?.(g),ge("accio_website.html_mode_change",{...L.current,newMode:g});break}case"DEVICE_CHANGED":{const{device:g}=c.data;we(g),re?.(g),ge("accio_website.html_device_change",{...L.current,newDevice:g});break}case"IMAGE_UPLOAD_REQUEST":{const g=D().current,T=c.data,x=T?.requestId,$=T?.file;if(!g||!x)break;if(!($ instanceof Blob)){he(g,"IMAGE_UPLOAD_RESULT",{requestId:x,success:!1,error:"missing upload file"});break}_n($,T.fileName,Q).then(E=>{he(g,"IMAGE_UPLOAD_RESULT",{requestId:x,success:!0,imgUrl:E})}).catch(E=>{ge("accio_website.html_image_upload_fail",{...L.current,errorType:"upload_failed"}),he(g,"IMAGE_UPLOAD_RESULT",{requestId:x,success:!1,error:E instanceof Error?E.message:String(E)})});break}}})},[y,Q,D,ae,ye,_,ie,re,oe]),(0,s.useEffect)(()=>{if(!y)return;const c=D().current;c&&he(c,"SET_APPLY_LOADING",{loading:se})},[se,y,D]);const Ce=(0,s.useMemo)(()=>{const c=O!==void 0?O:!d;if(c!==!1)return c===!0?"allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts":c},[O,d]);return xe?(0,n.jsxs)("div",{className:ke("flex flex-col items-center justify-center p-6 min-h-[100px]","bg-red-50 border border-red-200 rounded",m),style:h,children:[(0,n.jsx)("div",{className:"text-2xl mb-2",children:"⚠️"}),(0,n.jsx)("div",{className:"text-red-700 text-sm",children:be})]}):(0,n.jsxs)("div",{className:ke("relative",m),style:{flex:1,height:"100%",...h},children:[(0,n.jsx)("iframe",{ref:q,...d?{src:d}:{srcDoc:de},style:{width:"100%",height:"100%",border:"none",...t},className:ke("block w-full border-none bg-white",u),title:N,sandbox:Ce,onLoad:Ee,onError:Se}),me&&le&&(0,n.jsx)("div",{className:"absolute inset-0 flex items-center justify-center bg-white/90 z-10",children:f??(0,n.jsx)(Hn,{})})]})}function Qn(l){return!l||l.startsWith("http://")||l.startsWith("https://")?!0:!l.includes("complete")}je();Re();Ge();Ke();Ve();Ye();ln();pn();nn();Pe();Xe();Qe();var Bn=["pc","mobile","both"];function Rn(){return(0,s.useCallback)(()=>{Z.setState(l=>({fileTreeVersion:l.fileTreeVersion+1})),an.getState().incrementWorkspaceFileChangesRefreshTrigger()},[])}function Pn(l){try{const p=Z.getState(),d=l?.trim()||p.activeConversationId;if(!d)return null;const m=`publish-${Date.now()}`,h=p.sessionMetas.find(C=>C.id===d);if(!h)return{conversationId:d,agentId:null,agentType:null,sourcePluginId:null,messageId:m};const w=p.agents.find(C=>C.id===h.agentId);return{conversationId:d,agentId:h.agentId||null,agentType:w?.agentType||null,sourcePluginId:w?.sourcePluginId||null,messageId:m}}catch{return null}}function et({aliid:l,chatPublish:p,sourceFileUrl:d,conversationId:m,className:h,onPublished:w,onCreated:C}){const{t}=Be("chat"),u=fn(),{request:S,available:A,getGatewayInfoForUpload:I}=Ne(),P=en().workspace,me=bn(),f=(0,s.useMemo)(()=>{const e=l!=null?String(l).trim():"";return e||(me?.trim()??"")},[l,me]),N=dn(),O=sn(),y=tn(),fe=Z(e=>e.addMessage),ie=Z(e=>e.addTeamMessage),re=Z(e=>e.sendWsMessage),oe=cn(),ae=Rn(),ye=(0,s.useMemo)(()=>({canSend:!!(O&&y)||!!N,sendAsUserMessage:(e,a)=>{const i=rn(),r=on({clientId:i,content:e});if(O&&y)ie(O.id,y.id,r);else if(N)fe(N.id,r);else return;re(e,{clientId:i,workingDirectory:a?.workingDirectory??oe??void 0})}}),[O,y,N,ie,fe,re,oe]),_=p??ye,se=w??ae,o=C??ae,[Q,le]=(0,s.useState)(!1),[W,xe]=(0,s.useState)(!1),[F,be]=(0,s.useState)(null),[V,ce]=(0,s.useState)(null),[k,G]=(0,s.useState)(null),[we,ve]=(0,s.useState)(new Set),[Te,q]=(0,s.useState)(null),[ee,z]=(0,s.useState)(!1),[L,D]=(0,s.useState)(""),[K,M]=(0,s.useState)(0),Y=(0,s.useRef)(null),de=!f;(0,s.useEffect)(()=>{if(!Q||!f)return;let e=!1;return xe(!0),ce(null),S("/api/shop-home/page-list",{method:"POST",body:JSON.stringify({aliId:f})}).then(a=>{if(e||!a)return;be(a),R({type:"track.shop_home.records.loaded",name:"ShopHomePublishToolbar",input:{aliId:f,groupCount:a.groups.length}});const i=a.groups[0]?.id;i&&ve(new Set([i]))}).catch(a=>{e||ce(a instanceof Error?a.message:String(a))}).finally(()=>{e||xe(!1)}),()=>{e=!0}},[Q,f,S,K]);const Ee=(0,s.useCallback)(e=>{ve(a=>{const i=new Set(a);return i.has(e)?i.delete(e):i.add(e),i})},[]),Se=(0,s.useCallback)(async(e,a)=>{if(f&&_.canSend){G("publish");try{const i=Ae(a),r=await En({sourceFileUrl:d,workspace:P,getGatewayInfoForUpload:I}).catch(()=>{}),b=r?JSON.stringify(r):"{}";R({type:"track.shop_home.publish.mcp_call",name:"ShopHomePublishToolbar",input:{aliId:f,pageId:e.id,publishType:i,hasFilemap:!!r,filemapKeyCount:r?Object.keys(r).length:0}});const B=Pn(m),X={filemap_data:b,publish_type:i};if(e.id&&e.id.trim()){const v=Number(e.id);X.page_id=Number.isFinite(v)?v:e.id}const J=await wn.mcpCall("aw_publish_website_gui",X,B);let pe=!1,H,j="";try{let v=J;if(typeof J=="string")try{v=JSON.parse(J)}catch{j=J}if(v&&typeof v=="object"){let ne;if(v?.content?.[0]?.text)ne=String(v.content[0].text);else if(v?.result?.content?.[0]?.text)ne=String(v.result.content[0].text);else if(v?.data?.result){const U=v.data.result;ne=typeof U=="string"?U:JSON.stringify(U)}if(ne)try{const U=JSON.parse(ne)?.result?.data?.payload?.result;if(U){const Ie=U.data;pe=U.success&&Ie?.businessSuccess,j=Ie?.businessErrorMsg||U.errorMessage||"",H=Ie?.domain}}catch{j=ne}}}catch{}if(pe){se(),le(!1);const v=H?` (${H})`:"";u.show(`${t("shopHome.publishSent",{page:e.title})}${v}`,"success")}else u.show(`${t("shopHome.publishFailed")}: ${j||"Unknown error"}`,"error");const Le=m?.trim()||Z.getState().activeConversationId;if(Le){const v=H?/^https?:\/\//i.test(H)?H:`https://${H.replace(/^\/+/,"")}`:"";_e({conversationId:Le,content:pe?v?t("shopHome.publishNotice.successWithDomain",{page:e.title,domain:v}):t("shopHome.publishNotice.success",{page:e.title}):j?t("shopHome.publishNotice.failureWithReason",{page:e.title,reason:j}):t("shopHome.publishNotice.failure",{page:e.title}),role:"assistant",metadata:{type:"publish_notification",publishStatus:pe?"success":"failure",pageId:e.id,pageTitle:e.title,publishType:i,...H?{domain:H}:{},...v?{url:v}:{},...j?{message:j}:{}}})}R({type:"track.shop_home.publish.result",name:"ShopHomePublishToolbar",input:{aliId:f,pageId:e.id,publishType:i,success:String(pe),domain:H||""}})}catch(i){const r=i instanceof Error?i.message:String(i);u.show(`${t("shopHome.publishFailed")}${r?`: ${r}`:""}`,"error"),R({type:"track.shop_home.publish.error",name:"ShopHomePublishToolbar",input:{aliId:f,pageId:e.id},errorMessage:r});const b=m?.trim()||Z.getState().activeConversationId;b&&_e({conversationId:b,content:r?t("shopHome.publishNotice.failureWithReason",{page:e.title,reason:r}):t("shopHome.publishNotice.failure",{page:e.title}),role:"assistant",metadata:{type:"publish_notification",publishStatus:"failure",pageId:e.id,pageTitle:e.title,publishType:Ae(a),...r?{message:r}:{}}})}finally{G(null),q(null)}}},[f,_,se,u,t,d,P,I,m]),Ce=(0,s.useCallback)(()=>{D(""),z(!0),requestAnimationFrame(()=>Y.current?.focus())},[]),c=(0,s.useCallback)(()=>{z(!1),D("")},[]),g=(0,s.useCallback)(async()=>{const e=L.trim();if(!(!e||!f)){G("create");try{R({type:"track.shop_home.create_homepage.api",name:"ShopHomePublishToolbar",input:{aliid:f,pageName:e}});const a=await S("/api/shop-home/create-homepage",{method:"POST",body:JSON.stringify({aliId:f,pageName:e})});if(a?.businessSuccess===!1){const i=a.businessErrorMsg||t("shopHome.createFailed");u.show(i,"error"),R({type:"track.shop_home.create_homepage.error",name:"ShopHomePublishToolbar",input:{aliid:f,pageName:e},errorMessage:i});return}o(),z(!1),D(""),M(i=>i+1),u.show(t("shopHome.createSuccess",{page:e}))}catch(a){const i=a instanceof Error?a.message:String(a);u.show(`${t("shopHome.createFailed")}${i?`: ${i}`:""}`,"error"),R({type:"track.shop_home.create_homepage.error",name:"ShopHomePublishToolbar",input:{aliid:f,pageName:e},errorMessage:i})}finally{G(null)}}},[L,f,S,o,u,t]),T=(0,s.useCallback)(async(e,a)=>{if(_.canSend){if(!a.sourceZipOssUrl&&!a.htmlOssUrl){u.show(t("shopHome.retrieveNoResource"),"error");return}try{const i=Tn({pageId:e,versionId:a.versionId,versionName:a.name||a.versionId,sourceZipOssUrl:a.sourceZipOssUrl,htmlOssUrl:a.htmlOssUrl});R({type:"track.shop_home.retrieve.chat_message",name:"ShopHomePublishToolbar",input:{pageId:e,versionId:a.versionId}}),await _.sendAsUserMessage(i),le(!1),u.show(t("shopHome.retrieveSent",{version:a.name||a.versionId}))}catch(i){const r=i instanceof Error?i.message:String(i),b=i instanceof Error&&i.name==="ConversationDeliveryPendingError";u.show(b?r:`${t("shopHome.retrieveFailed")}${r?`: ${r}`:""}`,b?"warning":"error")}}},[_,u,t]),x=!_.canSend,$=de?t("shopHome.noAliid"):x?t("shopHome.needSession"):A?t("shopHome.publishToSite"):`${t("shopHome.publishToSite")} — ${t("shopHome.gatewayUnavailable")}`,E=(0,s.useCallback)(e=>{!e&&k==="publish"||(le(e),e||(z(!1),D(""),q(null)),e&&f&&R({type:"track.shop_home.popover.open",name:"ShopHomePublishToolbar",input:{aliid:f}}))},[f,k]);return(0,n.jsxs)(n.Fragment,{children:[(0,n.jsxs)(Me,{open:Q,onOpenChange:E,children:[(0,n.jsx)($e,{asChild:!0,children:(0,n.jsxs)("button",{type:"button",disabled:de,title:$,className:De("no-drag-region h-7 px-2 flex items-center gap-1 rounded-lg text-[11px] font-medium transition-colors shrink-0",de?"opacity-40 cursor-not-allowed text-zinc-400":"bg-primary/10 text-primary hover:bg-primary/15 dark:hover:bg-primary/20",h),children:[(0,n.jsx)(te,{name:"upload",size:14,className:"shrink-0"}),(0,n.jsx)("span",{className:"max-[380px]:hidden",children:t("shopHome.publishToSite")})]})}),(0,n.jsx)(We,{children:(0,n.jsx)(Ue,{side:"bottom",align:"end",sideOffset:8,collisionPadding:16,className:"z-[1100] outline-none",children:(0,n.jsxs)("div",{className:"relative flex flex-col bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg w-[min(420px,calc(100vw-2rem))] max-h-[min(520px,75vh)] overflow-hidden",children:[k==="publish"&&(0,n.jsxs)("div",{className:"absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-sm",role:"status","aria-live":"polite",children:[(0,n.jsx)("span",{className:"inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary",children:(0,n.jsx)(te,{name:"progress_activity",size:24,className:"animate-spin"})}),(0,n.jsxs)("div",{className:"text-center",children:[(0,n.jsx)("div",{className:"text-sm font-medium text-zinc-900 dark:text-zinc-100",children:t("shopHome.publishing")}),(0,n.jsx)("div",{className:"mt-1 text-[11px] text-zinc-500 dark:text-zinc-400",children:t("shopHome.publishingHint")})]})]}),(0,n.jsx)("div",{className:"px-3 py-2.5 border-b border-zinc-200 dark:border-zinc-700 shrink-0 bg-zinc-50/80 dark:bg-zinc-900/80",children:ee?(0,n.jsxs)("div",{className:"flex flex-col gap-2",children:[(0,n.jsx)("span",{className:"text-xs font-semibold text-zinc-800 dark:text-zinc-100",children:t("shopHome.createHomepage")}),(0,n.jsx)(qe,{ref:Y,value:L,onChange:e=>D(e.target.value),onKeyDown:e=>{e.key==="Enter"&&g(),e.key==="Escape"&&c()},placeholder:t("shopHome.pageNamePlaceholder"),className:"h-8 text-xs",disabled:k==="create",autoFocus:!0}),(0,n.jsxs)("div",{className:"flex justify-end gap-1.5",children:[(0,n.jsx)(ue,{type:"button",variant:"outline",size:"sm",className:"h-7 text-[11px] rounded-lg",disabled:k==="create",onClick:c,children:t("shopHome.createCancel")}),(0,n.jsx)(ue,{type:"button",variant:"default",size:"sm",className:"h-7 text-[11px] rounded-lg",disabled:!L.trim()||k==="create",onClick:()=>void g(),children:t(k==="create"?"shopHome.creating":"shopHome.createConfirm")})]})]}):(0,n.jsxs)("div",{className:"flex items-center justify-between gap-2",children:[(0,n.jsx)("span",{className:"text-xs font-semibold text-zinc-800 dark:text-zinc-100",children:t("shopHome.selectPage")}),(0,n.jsx)(ue,{type:"button",variant:"outline",size:"sm",className:"h-7 text-[11px] rounded-lg border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700",disabled:!f||k!==null,onClick:Ce,children:t("shopHome.createHomepage")})]})}),(0,n.jsxs)("div",{className:"flex-1 min-h-0 overflow-y-auto p-2",children:[W&&(0,n.jsxs)("div",{className:"flex items-center justify-center gap-2 py-8 text-zinc-500 text-xs",children:[(0,n.jsx)("span",{className:"inline-flex animate-spin text-primary",children:(0,n.jsx)(te,{name:"progress_activity",size:18})}),t("shopHome.loading")]}),!W&&V&&(0,n.jsx)("p",{className:"text-xs text-red-600 dark:text-red-400 px-2 py-4",children:V}),!W&&!V&&F&&F.groups.map(e=>{const a=we.has(e.id),i=Te===e.id;return(0,n.jsxs)("div",{className:"mb-2 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-white dark:bg-zinc-900/40",children:[(0,n.jsxs)("div",{className:"flex items-stretch gap-1 px-1 py-1",children:[(0,n.jsxs)("button",{type:"button",onClick:()=>Ee(e.id),className:"flex-1 min-w-0 flex items-center gap-2 px-1 py-1.5 text-left rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/80",children:[(0,n.jsx)(te,{name:a?"expand_less":"expand_more",size:18,className:"text-zinc-400 shrink-0"}),(0,n.jsx)(te,{name:"folder",size:16,className:"text-zinc-500 dark:text-zinc-400 shrink-0"}),(0,n.jsx)("span",{className:"flex-1 min-w-0 text-[12px] font-medium truncate text-zinc-900 dark:text-zinc-100",children:e.title}),(0,n.jsx)("span",{className:De("text-[10px] px-1.5 py-0.5 rounded shrink-0",e.status==="published"?"bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400":"bg-zinc-100 text-zinc-500 dark:bg-zinc-700/80 dark:text-zinc-400"),children:e.status==="published"?t("shopHome.published"):t("shopHome.archived")}),(0,n.jsx)("span",{className:"text-[10px] text-zinc-500 shrink-0 hidden sm:inline",children:t("shopHome.historyVersions",{count:e.versionCount})})]}),i?(0,n.jsxs)("div",{className:"flex items-center gap-1 self-center shrink-0",children:[Bn.map(r=>(0,n.jsx)(ue,{type:"button",variant:"outline",size:"sm",className:"h-7 text-[10px] px-2 shrink-0",disabled:k==="publish",onClick:()=>void Se(e,r),children:t(r==="pc"?"shopHome.terminalPc":r==="mobile"?"shopHome.terminalMobile":"shopHome.terminalBoth")},r)),(0,n.jsx)("button",{type:"button",className:"h-7 w-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:text-zinc-300 dark:hover:bg-zinc-800",onClick:()=>q(null),children:(0,n.jsx)(te,{name:"close",size:14})})]}):(0,n.jsx)(ue,{type:"button",variant:"default",size:"sm",title:x?t("shopHome.needSession"):void 0,className:"h-8 self-center text-[11px] px-2.5 shrink-0",disabled:k!==null||x,onClick:()=>q(e.id),children:t("shopHome.publish")})]}),a&&(0,n.jsx)("div",{className:"px-2 pb-3 pt-0 border-t border-zinc-100 dark:border-zinc-800",children:(0,n.jsx)("ul",{className:"space-y-2 mt-2",children:e.versions.map(r=>(0,n.jsxs)("li",{className:"flex items-center gap-2 text-[11px] rounded-md bg-zinc-50 dark:bg-zinc-800/60 px-2 py-1.5 border border-zinc-100 dark:border-zinc-700/80",children:[(0,n.jsxs)("div",{className:"flex flex-wrap items-center gap-2 flex-1 min-w-0",children:[(0,n.jsx)("span",{className:"font-mono text-zinc-800 dark:text-zinc-200",children:r.name||r.versionId}),r.isCurrentOnline&&(0,n.jsx)("span",{className:"text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400",children:t("shopHome.currentOnline")}),(0,n.jsxs)("span",{className:"text-zinc-500 text-[10px]",children:[r.publishedAt," · ",r.author]})]}),r?.supportRetrieve&&(0,n.jsx)("button",{type:"button",disabled:k!==null||x,onClick:()=>T(e.id,r),className:"shrink-0 text-[10px] font-medium text-primary hover:text-primary/80 disabled:opacity-40 disabled:cursor-not-allowed",children:t("shopHome.retrieve")})]},r.versionId))})})]},e.id)}),!W&&!V&&F&&F.groups.length===0&&(0,n.jsx)("p",{className:"text-xs text-zinc-500 px-2 py-6 text-center",children:t("shopHome.empty")})]})]})})})]}),(0,n.jsx)(yn,{toasts:u.toasts})]})}var Nn=["http://","https://","data:","blob:","#","javascript:","mailto:","//"];function On(l){return!Nn.some(p=>l.startsWith(p))}function zn(l,p,d,m){if(!On(l))return l;let h,w;if(l.startsWith("../"))h=d,w=l.replace(/^\.\.\//,"");else if(l.startsWith("./"))h=p,w=l.substring(2);else if(!l.startsWith("/"))h=p,w=l;else return l;return`${m}/workspace/file?root=${encodeURIComponent(h)}&path=${encodeURIComponent(w)}`}async function nt(l,p,d){const m=p.split("/").slice(0,-1).join("/"),h=m.split("/").slice(0,-1).join("/"),w=await d?.getGatewayInfo?.();if(!w)return{processedHtml:l,cleanup:()=>{}};const C=u=>zn(u,m,h,w.url);let t=l;return t=t.replace(/(src|href)\s*=\s*(["'])([^"']*)\2/gi,(u,S,A,I)=>{const P=C(I);return P!==I?`${S}=${A}${P}${A}`:u}),t=t.replace(/(["'])(\.\.?\/[^"']+)\1/g,(u,S,A)=>{const I=C(A);return I!==A?`${S}${I}${S}`:u}),{processedHtml:t,cleanup:()=>{}}}const tt="/html-preview",it="phoenix-html-preview-sync",rt="phoenix-html-preview";export{et as a,nt as i,it as n,Qn as o,rt as r,Zn as s,tt as t};
