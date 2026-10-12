import{s as ir}from"./rolldown-runtime-BSJ3dJRS.js";import{a as Zr,i as Jr}from"./vendor-react-BflrOYNF.js";import{i as ve,r as Oe}from"./vendor-i18n-udtrfyWc.js";import{Tt as Qr,wt as an}from"./vendor-ui-BcaUJBsv.js";import{$r as or,Ai as ei,Ci as ti,Fi as ni,Kr as st,Oa as ar,Oi as ri,Ui as ii,_i as oi,aa as Hn,ia as sr,ja as me,ka as lr,mi as ai,mr as St,ni as si,oi as li,pi as di,qr as ci,si as ui,wi as hi}from"./index-B3kRscgu.js";import{At as X,C as fi,Mt as pi,Nt as Ct,kt,w as gi}from"./gateway-client-BZvNv_1t.js";import{i as zt,n as Me}from"./index.desktop-CIjlN4kD.js";import{b as mi,d as vi,n as xi}from"./file-upload-ljvyVPjH.js";import{n as yi}from"./vendor-sanitize-ZqtdjMRs.js";import{n as bi,t as Ei}from"./toast-QkYvegOn.js";import{n as wi,r as _t}from"./iframe-anchor-nav-DtfhSthP.js";var Vn=`/**
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
`,$n=`/* eslint-disable */
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

  function extractGradientColor(bgImage) {
    if (!bgImage || bgImage === 'none') return null;
    var m = bgImage.match(/rgba?\\(\\s*\\d+[\\s,]+\\d+[\\s,]+\\d+(?:[\\s,/]+[\\d.]+)?\\s*\\)/);
    if (m) return m[0];
    var hex = bgImage.match(/#[0-9a-fA-F]{3,8}/);
    if (hex) return hex[0];
    return null;
  }

  function getStyles(el) {
    var clone;
    try {
      const win = getIframeWin();
      if (!win) return {};
      // Clone to avoid :hover/:active pseudo-class contamination
      clone = el.cloneNode(false);
      clone.removeAttribute('data-canvas-selected');
      clone.removeAttribute('contenteditable');
      clone.style.setProperty('position', 'fixed', 'important');
      clone.style.setProperty('visibility', 'hidden', 'important');
      clone.style.setProperty('pointer-events', 'none', 'important');
      clone.style.setProperty('left', '-99999px', 'important');
      clone.style.setProperty('top', '-99999px', 'important');
      el.parentNode.insertBefore(clone, el.nextSibling);
      clone.offsetHeight;
      const i = win.getComputedStyle(clone);
      var bgColor = i.backgroundColor;
      var bgImage = i.backgroundImage;
      if (bgImage && bgImage !== 'none') {
        var gradientColor = extractGradientColor(bgImage);
        if (gradientColor) bgColor = gradientColor;
      }
      var result = {
        color: i.color,
        backgroundColor: bgColor,
        backgroundImage: bgImage,
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
      clone.parentNode.removeChild(clone);
      return result;
    } catch (e) {
      try { if (clone && clone.parentNode) clone.parentNode.removeChild(clone); } catch (_) {}
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
`,Wn=`/* eslint-disable */
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
  function resolveColor(val, el) {
    if (!val) return '';
    if (val.indexOf('var(') === -1) return val;
    var cs = window.getComputedStyle(el);
    var varMatch = val.match(/var\\(\\s*(--[^,)]+)/);
    if (varMatch) {
      var resolved = cs.getPropertyValue(varMatch[1]).trim();
      if (resolved) return resolved;
    }
    return val;
  }
  function isFullyTransparentColor(value) {
    if (!value) return false;
    var color = value.trim().toLowerCase();
    if (color === 'transparent') return true;
    var hex = color.match(/^#(?:[0-9a-f]{3}([0-9a-f])|[0-9a-f]{6}([0-9a-f]{2}))$/);
    if (hex) {
      var hexAlpha = hex[1] ? hex[1] + hex[1] : hex[2];
      return parseInt(hexAlpha, 16) === 0;
    }
    if (color.indexOf('rgba(') !== 0 && color.indexOf('/') === -1) return false;
    var alpha = color.match(/(?:,|\\/)\\s*([\\d.]+)(%)?\\s*\\)$/);
    return Boolean(alpha) && parseFloat(alpha[1]) === 0;
  }
  function resolveHoverBackgroundColor(hoverBackgroundColor, bgColor) {
    return hoverBackgroundColor || (isFullyTransparentColor(bgColor) ? '' : bgColor);
  }
  // 把含 :hover 的选择器降级为"基础选择器"以便在元素非 hover 态时也能匹配。
  // 例如 ".hover\\:text-brand-coral:hover" → ".hover\\:text-brand-coral"，
  //      "a:hover" → "a"，".btn:hover .icon" → ".btn .icon"。
  // 直接用完整带 :hover 的选择器做 el.matches() 时，元素当前不在 hover 态会匹配失败，
  // 导致 Tailwind 的 hover:text-xxx 等 hover 颜色读不到（面板回退成黑色）。
  function stripHoverPseudo(selectorText) {
    return selectorText.replace(/:hover/g, '').replace(/\\s+/g, ' ').trim();
  }
  // 从一条 CSS 规则读取某类颜色，兼容简写属性含 var() 的情况。
  // 背景：当规则写成简写（如 \`background: var(--surface-2)\`）时，CSSOM 规范会把
  // 简写内所有 longhand 标为 "pending-substitution"，导致 rule.style.backgroundColor
  // 读到空字符串。此时需退回读简写本身（rule.style.background），再交 resolveColor
  // 解析 var()。color 无简写、border-color 亦可能藏在 border 简写里，一并兜底。
  function readRuleColor(ruleStyle, kind, el) {
    var direct = kind === 'color'
      ? ruleStyle.color
      : kind === 'background'
        ? ruleStyle.backgroundColor
        : ruleStyle.borderColor;
    if (direct) return resolveColor(direct, el);
    // 简写兜底
    var shorthand = kind === 'background'
      ? ruleStyle.background
      : kind === 'border'
        ? (ruleStyle.borderColor || ruleStyle.border)
        : '';
    if (!shorthand) return '';
    // 从简写里提取第一个颜色 token：var(...) / rgb[a](...) / #hex / 颜色关键字。
    var varM = shorthand.match(/var\\(\\s*--[^,)]+[^)]*\\)/);
    if (varM) return resolveColor(varM[0], el);
    var colM = shorthand.match(/rgba?\\([^)]*\\)|#[0-9a-fA-F]{3,8}/);
    if (colM) return resolveColor(colM[0], el);
    return '';
  }
  function getHoverStyles(el) {
    var result = { hoverColor: '', hoverBackgroundColor: '', hoverBorderColor: '' };
    function scan(rules) {
      if (!rules) return;
      for (var r = 0; r < rules.length; r++) {
        var rule = rules[r];
        if (!rule.selectorText || rule.selectorText.indexOf(':hover') === -1) continue;
        var base = stripHoverPseudo(rule.selectorText);
        if (!base) continue;
        // 用去掉 :hover 的基础选择器匹配：元素当前是否 hover 都能命中规则。
        try { if (!el.matches(base)) continue; } catch (_) { continue; }
        var c = readRuleColor(rule.style, 'color', el);
        var bg = readRuleColor(rule.style, 'background', el);
        var bd = readRuleColor(rule.style, 'border', el);
        if (c) result.hoverColor = c;
        if (bg) result.hoverBackgroundColor = bg;
        if (bd) result.hoverBorderColor = bd;
      }
    }
    try {
      var sheets = document.styleSheets;
      for (var s = 0; s < sheets.length; s++) {
        var rules;
        try { rules = sheets[s].cssRules || sheets[s].rules; } catch (_) { continue; }
        scan(rules);
      }
      var injected = document.getElementById('__editor_hover_styles__');
      if (injected) {
        var irules;
        try { irules = injected.sheet.cssRules; } catch (_) {}
        scan(irules);
      }
    } catch (_) {}
    return result;
  }
  function extractGradientColor(bgImage) {
    if (!bgImage || bgImage === 'none') return null;
    var m = bgImage.match(/rgba?\\(\\s*\\d+[\\s,]+\\d+[\\s,]+\\d+(?:[\\s,/]+[\\d.]+)?\\s*\\)/);
    if (m) return m[0];
    var hex = bgImage.match(/#[0-9a-fA-F]{3,8}/);
    if (hex) return hex[0];
    return null;
  }
  function getStyles(el) {
    try {
      // Clone the element to read computed styles without :hover/:active contamination.
      // During pointerdown the element has :hover state; a clone never does.
      var clone = el.cloneNode(false);
      clone.removeAttribute('data-canvas-selected');
      clone.removeAttribute('contenteditable');
      clone.style.setProperty('position', 'fixed', 'important');
      clone.style.setProperty('visibility', 'hidden', 'important');
      clone.style.setProperty('pointer-events', 'none', 'important');
      clone.style.setProperty('left', '-99999px', 'important');
      clone.style.setProperty('top', '-99999px', 'important');
      el.parentNode.insertBefore(clone, el.nextSibling);
      clone.offsetHeight;
      const i = window.getComputedStyle(clone);
      var hover = getHoverStyles(el);
      var bgColor = i.backgroundColor;
      var bgImage = i.backgroundImage;
      if (bgImage && bgImage !== 'none') {
        var gradientColor = extractGradientColor(bgImage);
        if (gradientColor) bgColor = gradientColor;
      }
      var result = {
        color: i.color,
        backgroundColor: bgColor,
        backgroundImage: bgImage,
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
        // 透明基础背景不是 hover 颜色，否则首次选色会继承 alpha=0。
        hoverColor: hover.hoverColor || i.color,
        hoverBackgroundColor: resolveHoverBackgroundColor(hover.hoverBackgroundColor, bgColor),
        hoverBorderColor: hover.hoverBorderColor || i.borderColor,
      };
      clone.parentNode.removeChild(clone);
      return result;
    } catch (e) {
      try { if (clone && clone.parentNode) clone.parentNode.removeChild(clone); } catch (_) {}
      return {};
    }
  }
  function getInlineStyles(el) {
    var s = el.style;
    return {
      color: s.color || '',
      backgroundColor: s.backgroundColor || '',
      backgroundImage: s.backgroundImage || '',
      width: s.width || '',
      height: s.height || '',
      display: s.display || '',
      objectFit: s.objectFit || '',
      fontSize: s.fontSize || '',
      fontStyle: s.fontStyle || '',
      fontWeight: s.fontWeight || '',
      fontFamily: s.fontFamily || '',
      textAlign: s.textAlign || '',
      textDecoration: s.textDecoration || '',
      borderRadius: s.borderRadius || '',
      borderWidth: s.borderWidth || '',
      borderStyle: s.borderStyle || '',
      borderColor: s.borderColor || '',
      opacity: s.opacity || '',
      marginLeft: s.marginLeft || '',
      marginRight: s.marginRight || '',
      marginTop: s.marginTop || '',
      marginBottom: s.marginBottom || '',
      paddingLeft: s.paddingLeft || '',
      paddingRight: s.paddingRight || '',
      paddingTop: s.paddingTop || '',
      paddingBottom: s.paddingBottom || '',
    };
  }
  function gl(el, attr) {
    const c = el[attr];
    if (!c) return '';
    if (typeof c === 'object' && 'baseVal' in c) return c.baseVal || '';
    if (typeof c === 'string') return c;
    if (attr === 'className') return el.getAttribute('class') || '';
    return el.getAttribute(attr) || '';
  }
  function getComponentPath(el) {
    var path = [];
    var cur = el;
    while (cur && cur !== document.body) {
      var comp = cur.getAttribute('data-component');
      if (comp) path.push(comp);
      cur = cur.parentElement;
    }
    return path;
  }
  // 读取元素的源码定位（data-loc，构建期 babel 插件注入，格式 "src/main.jsx:line:col"）。
  // **只取元素自身的 data-loc,绝不向上取祖先**:运行时生成/第三方库渲染的子元素
  // 没有 data-loc,若回退到祖先的 srcLoc,服务端 AST 会把 set-text/set-style/
  // remove-element 确定性地写到祖先元素上(remove 会删掉整个祖先子树),与画布
  // 预览(作用于被选中 DOM)不一致。无 data-loc → 返回空,splitAtomicEdits 自然
  // 走 aiFallback(AI 有完整上下文,能正确定位)。
  function getSrcLoc(el) {
    if (!el || !el.getAttribute) return '';
    return el.getAttribute('data-loc') || '';
  }
  function getElementData(el) {
    const tag = el.tagName.toLowerCase();
    const componentPath = getComponentPath(el);
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
      component: componentPath[0] || '',
      componentPath: componentPath,
      srcLoc: getSrcLoc(el),
      style: getStyles(el),
      inlineStyle: getInlineStyles(el),
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
  const Mu = 1,
    xg = [6, 3],
    wg = 'rgba(30,173,111,0.6)',
    Sg = 'rgba(0,0,0,0)',
    Au = 'rgba(30,173,111,0.04)';

  var dirtyHighlightActive = false;

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
      const dirtyEls = dirtyHighlightActive
        ? Array.from(document.querySelectorAll('[data-canvas-dirty]'))
        : [];
      if (!act && !hov && dirtyEls.length === 0) return;
      hlCtx.save();
      if (this.exclusionRects.size > 0) {
        hlCtx.beginPath();
        hlCtx.rect(0, 0, W, H);
        for (const r of this.exclusionRects.values())
          hlCtx.rect(r.left || r.x, r.top || r.y, r.width, r.height);
        hlCtx.clip('evenodd');
      }
      for (const del of dirtyEls) {
        this._drawNu(del, {
          strokeStyle: 'rgba(249, 115, 22, 0.8)',
          lineDash: [6, 3],
          lineWidth: 2,
          fillColor: Sg,
          noTag: true,
        });
      }
      if (act && !dirtyHighlightActive && !act.hasAttribute('data-canvas-highlighted')) this._drawNu(act, { fillColor: Sg });
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
      ctx.beginPath();
      ctx.rect(r.left, r.top, r.width, r.height);
      ctx.lineWidth = opts.lineWidth ?? Mu;
      ctx.strokeStyle = opts.strokeStyle ?? wg;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.fillStyle = opts.fillColor ?? Au;
      ctx.fill();
      ctx.stroke();
      if (!opts.noTag) this._drawTag(r, el.tagName.toLowerCase());
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
      ctx.fillStyle = '#1ead6f';
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
      ctx.strokeStyle = 'rgba(24,140,89,0.3)';
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
  let externalPanel = false;

  // ===== 三态边框 CSS（externalPanel 模式注入） =====
  const CANVAS_BORDER_STYLE_ID = '__canvas_border_style__';
  // iframe/video 在编辑态下需要 pointer-events:none，否则嵌套内容吞掉 pointerdown。
  // 用坐标匹配在 onPointerOver/onPointerDown 里还原对这些元素的选中能力。
  var MEDIA_SELECTOR = 'iframe:not([_editor_ignore]), video:not([_editor_ignore])';
  function findMediaElementAtPoint(x, y) {
    var els = document.querySelectorAll(MEDIA_SELECTOR);
    for (var i = 0; i < els.length; i++) {
      if (isIgnored(els[i])) continue;
      var r = els[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return els[i];
    }
    return null;
  }

  function injectCanvasBorderCSS() {
    if (document.getElementById(CANVAS_BORDER_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = CANVAS_BORDER_STYLE_ID;
    style.textContent = \`
      body:not(.dirty-highlight-mode) *:not([_editor_ignore]):not(script):not(style):not(canvas):not(#hlCanvas):not(.etb-wrap):not(.si-overlay):not(#cmSvg):not(#cmBox):not([data-canvas-selected]):not([data-canvas-dirty]):hover:not(:has(:hover)) {
        outline: none !important;
      }
      body:not(.dirty-highlight-mode) [data-canvas-selected]:not([data-canvas-highlighted]) {
        outline: none !important;
      }
      [data-canvas-dirty] {
        outline: none !important;
      }
      iframe:not([_editor_ignore]), video:not([_editor_ignore]) {
        pointer-events: none !important;
      }
    \`;
    document.head.appendChild(style);
    // NOTE: 不再拦截/禁用页面元素的原生 :hover 视觉效果。
    //   早期尝试用 \`:where(html[data-accio-canvas] *):hover { ...: revert }\` 把所有
    //   hover 视觉抹平,统一由 editor 高亮方框接管,但 revert 在含背景继承/渐变的元素上
    //   会把整块背景冲白(用户多次反馈),且 transition/伪元素等边界很难穷尽,收益小、坑多。
    //   现策略:画布编辑态保留页面真实 hover 效果,editor 的绿色高亮方框作为「附加」反馈层,
    //   二者并存即可。removeCanvasBorderCSS 仅清理本函数注入的 outline 样式。
  }
  function removeCanvasBorderCSS() {
    const el = document.getElementById(CANVAS_BORDER_STYLE_ID);
    if (el) el.remove();
  }

  // ===== externalPanel: 向宿主发消息 =====
  function postToHost(type, data) {
    window.parent.postMessage({ type, data }, '*');
  }
  function findByEditPath(editPath) {
    return document.querySelector('[data-edit-path="' + editPath + '"]');
  }
  // 参照 Open Design annotateManualEditSourcePaths：为 DOM 树批量注入 data-edit-path
  // META/TITLE/LINK/BASE：head 专属元素。完整 HTML 文档字符串被内插进 srcDoc
  // 模板 <body> 后，浏览器解析会把这些元素拍平到 body 顶部（与 DOMPurify 无关，
  // 该链路 enableSanitize 默认关闭）；若计入索引，内容元素的路径起点会整体偏移
  // （container 变成 3），与 React 源码侧（meta 在 head、body 从 0 起算）错位，
  // 本地补丁定位失败全部降级 AI。两侧过滤集必须一致（React 侧见
  // source-annotator.ts 的 SKIP_TAGS；CANVAS 在本文件经 isIgnored 整 tag 跳过，
  // 源码侧已同步加入 SKIP_TAGS）。
  var SKIP_TAGS_SET = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'META', 'TITLE', 'LINK', 'BASE']);
  function annotateLiveDOM() {
    function walk(el, segments) {
      if (SKIP_TAGS_SET.has(el.tagName)) return;
      if (isIgnored(el)) return;
      var path = segments.join('-');
      if (!el.getAttribute('data-edit-path')) {
        el.setAttribute('data-edit-path', path);
      }
      var childIdx = 0;
      for (var i = 0; i < el.children.length; i++) {
        var child = el.children[i];
        if (SKIP_TAGS_SET.has(child.tagName) || isIgnored(child)) continue;
        walk(child, segments.concat([String(childIdx)]));
        childIdx++;
      }
    }
    var childIdx = 0;
    for (var i = 0; i < document.body.children.length; i++) {
      var child = document.body.children[i];
      if (SKIP_TAGS_SET.has(child.tagName) || isIgnored(child)) continue;
      walk(child, [String(childIdx)]);
      childIdx++;
    }
    console.log('[Editor] annotateLiveDOM done');
  }
  // 单个元素的兜底标注（DOM 变化后新增的元素）
  function ensureEditPath(el) {
    var existing = el.getAttribute('data-edit-path');
    if (existing) return existing;
    var segments = [];
    var cur = el;
    while (cur && cur !== document.body && cur.nodeType === 1) {
      var parent = cur.parentElement;
      if (!parent) break;
      // 与 annotateLiveDOM 完全一致：SKIP_TAGS_SET 与 isIgnored（编辑器 UI）
      // 都不计数。此前只跳 SKIP_TAGS_SET：body 层编辑器 UI（hlCanvas 是 CANVAS
      // 不在 SKIP_TAGS_SET、etbWrap/siOverlay 是 DIV）被计入索引，兜底路径与
      // 批量标注/React 源码侧路径体系错位（0-0 被算成 3-0），本地补丁定位
      // 失败全部降级 AI。
      var idx = 0;
      for (var i = 0; i < parent.children.length; i++) {
        var sibling = parent.children[i];
        if (sibling === cur) break;
        if (!SKIP_TAGS_SET.has(sibling.tagName) && !isIgnored(sibling)) idx++;
      }
      segments.unshift(String(idx));
      cur = parent;
    }
    var path = segments.length > 0 ? segments.join('-') : 'dyn-' + (++_dynPathCounter);
    el.setAttribute('data-edit-path', path);
    return path;
  }

  // ===== EditToolbar =====
  const etbWrap = document.getElementById('etbWrap');
  function showETB() {
    if (externalPanel) return;
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
    var c = e.target;
    // pointer-events:none 的 iframe/video 不会成为 target，用坐标匹配还原
    var media = findMediaElementAtPoint(e.clientX, e.clientY);
    if (media) c = media;
    if (!isElement(c) || isIgnored(c)) {
      hoverTarget = null;
      hl.setHoverTarget(null);
      if (externalPanel) postToHost('ELEMENT_HOVERED', null);
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
      // pointer-events:none 的 iframe/video 不会成为 target，findBestTarget 内部
      // 只兜底 IMG/VIDEO,这里再用 findMediaElementAtPoint 补 IFRAME 场景。
      var media = findMediaElementAtPoint(e.clientX, e.clientY);
      if (media) c = media;
      // 点击空白区域(body/html)→ 取消选中(findBestTarget 返回 BODY 时也命中)。
      if (!c || c === document.body || c === document.documentElement) {
        if (activeTarget) deselectElement();
        return;
      }

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
      // externalPanel 模式：标记选中 + 通知宿主，不打开内部面板
      if (externalPanel) {
        // 清除上一个选中标记
        const prev = document.querySelector('[data-canvas-selected]');
        if (prev) prev.removeAttribute('data-canvas-selected');
        el.setAttribute('data-canvas-selected', '');
        // 确保元素有 data-edit-path（动态渲染的元素可能没有）
        if (!el.getAttribute('data-edit-path')) {
          el.setAttribute('data-edit-path', ensureEditPath(el));
        }
        var elRect = el.getBoundingClientRect();
        postToHost('ELEMENT_SELECTED', {
          ...getElementData(el),
          editPath: el.getAttribute('data-edit-path'),
          rect: { top: elRect.top, left: elRect.left, right: elRect.right, bottom: elRect.bottom, width: elRect.width, height: elRect.height },
        });
      } else {
        if (isDirectEditable(el)) setupEnterKeyListener();
        openSI(el);
        showETB();
        renderComments();
      }
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
    if (externalPanel) {
      const prev = document.querySelector('[data-canvas-selected]');
      if (prev) prev.removeAttribute('data-canvas-selected');
      postToHost('ELEMENT_DESELECTED');
      return;
    }
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
    if (externalPanel) return;
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
    hl.scheduleRender();
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
      if (externalPanel) {
        injectCanvasBorderCSS();
        // 延迟标注：等 React/框架渲染完成后再标注 live DOM
        setTimeout(function () { annotateLiveDOM(); }, 500);
      }
    } else {
      document.body.style.cursor = '';
      if (externalPanel) {
        // externalPanel 模式：保留选中状态（activeTarget / data-canvas-selected），
        // 只隐藏 hover 边框 CSS，切回 edit 时选中自动恢复。
        hl.clear();
        removeCanvasBorderCSS();
      } else {
        deselectElement();
        hl.clear();
        hideETB();
      }
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

  // 保存元素的原始 inline style attribute，用于精确还原
  var origInlineStyleMap = {};

  window.addEventListener('message', (event) => {
    // 仅信任来自直接父窗口的消息。iframe 若被外部页面嵌入或 window.open 拿到引用,
    // 攻击者可伪造 IMAGE_UPLOAD_RESULT 注入任意 image URL、或发 SET_MODE/PREVIEW_STYLE
    // 干扰编辑态。受信源就是 window.parent(画布父页面)。
    if (event.source !== window.parent) return;
    const { type, data } = event.data || {};
    switch (type) {
      case 'INIT':
        if (data?.externalPanel) externalPanel = true;
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
      // ===== externalPanel 模式：宿主 → iframe 消息 =====
      case 'PREVIEW_STYLE': {
        if (!data?.editPath || !data?.styles) break;
        const el = data.editPath === '__page__' ? document.body : findByEditPath(data.editPath);
        if (!el) break;
        // 首次修改该元素时，保存原始 inline style
        if (!(data.editPath in origInlineStyleMap)) {
          origInlineStyleMap[data.editPath] = el.getAttribute('style') || '';
        }
        var styleTag = document.getElementById('__editor_hover_styles__');
        if (!styleTag) {
          styleTag = document.createElement('style');
          styleTag.id = '__editor_hover_styles__';
          document.head.appendChild(styleTag);
        }

        // Detect if element has any :hover rules (custom or original CSS)
        var hasAnyHoverRule = false;
        // Check custom hover rules in our sheet
        var hs = '[data-edit-path="' + data.editPath + '"]:hover';
        for (var hi = 0; hi < styleTag.sheet.cssRules.length; hi++) {
          if (styleTag.sheet.cssRules[hi].selectorText === hs) { hasAnyHoverRule = true; break; }
        }
        // Check original stylesheets for :hover rules matching this element
        if (!hasAnyHoverRule) {
          var pSheets = document.styleSheets;
          for (var psi = 0; psi < pSheets.length && !hasAnyHoverRule; psi++) {
            if (pSheets[psi].ownerNode && pSheets[psi].ownerNode.id === '__editor_hover_styles__') continue;
            var pRules;
            try { pRules = pSheets[psi].cssRules || pSheets[psi].rules; } catch (_) { continue; }
            if (!pRules) continue;
            for (var pri = 0; pri < pRules.length; pri++) {
              var pRule = pRules[pri];
              if (!pRule.selectorText || pRule.selectorText.indexOf(':hover') === -1) continue;
              // Strip :hover to check if base selector matches element
              var baseSel = pRule.selectorText.replace(/:hover/g, '').replace(/\\s+/g, ' ').trim();
              if (!baseSel) continue;
              try { if (el.matches(baseSel)) { hasAnyHoverRule = true; break; } } catch (_) {}
            }
          }
        }

        for (const [prop, val] of Object.entries(data.styles)) {
          const cp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
          if (hasAnyHoverRule) {
            // Write to CSS normal rule instead of inline, so :hover can override
            el.style.removeProperty(cp);
            var ns = '[data-edit-path="' + data.editPath + '"]';
            var nIdx = -1;
            for (var nj = 0; nj < styleTag.sheet.cssRules.length; nj++) {
              if (styleTag.sheet.cssRules[nj].selectorText === ns) { nIdx = nj; break; }
            }
            var nStyles = {};
            if (nIdx >= 0) {
              var nr = styleTag.sheet.cssRules[nIdx];
              for (var nk = 0; nk < nr.style.length; nk++) {
                nStyles[nr.style[nk]] = nr.style.getPropertyValue(nr.style[nk]);
              }
              styleTag.sheet.deleteRule(nIdx);
            }
            if (val) nStyles[cp] = val;
            else delete nStyles[cp];
            var nCss = '';
            for (var nsp in nStyles) { nCss += nsp + ': ' + nStyles[nsp] + ' !important; '; }
            if (nCss) styleTag.sheet.insertRule(ns + ' { ' + nCss + '}', 0);

            // Ensure original hover styles are preserved with !important in our hover rule
            // so they can override our normal !important rule (higher specificity wins)
            var hoverSel = '[data-edit-path="' + data.editPath + '"]:hover';
            var hasCustomHoverProp = false;
            for (var chi = 0; chi < styleTag.sheet.cssRules.length; chi++) {
              if (styleTag.sheet.cssRules[chi].selectorText === hoverSel) {
                if (styleTag.sheet.cssRules[chi].style.getPropertyValue(cp)) hasCustomHoverProp = true;
                break;
              }
            }
            if (!hasCustomHoverProp) {
              // Find original hover value by stripping :hover and matching
              var origHoverVal = '';
              for (var osi = 0; osi < pSheets.length; osi++) {
                if (pSheets[osi].ownerNode && pSheets[osi].ownerNode.id === '__editor_hover_styles__') continue;
                var oRules;
                try { oRules = pSheets[osi].cssRules || pSheets[osi].rules; } catch (_) { continue; }
                if (!oRules) continue;
                for (var ori = 0; ori < oRules.length; ori++) {
                  var oRule = oRules[ori];
                  if (!oRule.selectorText || oRule.selectorText.indexOf(':hover') === -1) continue;
                  var oBase = oRule.selectorText.replace(/:hover/g, '').replace(/\\s+/g, ' ').trim();
                  if (!oBase) continue;
                  try { if (!el.matches(oBase)) continue; } catch (_) { continue; }
                  if (oRule.style.getPropertyValue(cp)) origHoverVal = oRule.style.getPropertyValue(cp);
                }
              }
              if (origHoverVal) {
                var hIdx = -1;
                for (var hi2 = 0; hi2 < styleTag.sheet.cssRules.length; hi2++) {
                  if (styleTag.sheet.cssRules[hi2].selectorText === hoverSel) { hIdx = hi2; break; }
                }
                var hStyles = {};
                if (hIdx >= 0) {
                  var hr = styleTag.sheet.cssRules[hIdx];
                  for (var hk = 0; hk < hr.style.length; hk++) {
                    hStyles[hr.style[hk]] = hr.style.getPropertyValue(hr.style[hk]);
                  }
                  styleTag.sheet.deleteRule(hIdx);
                }
                hStyles[cp] = origHoverVal;
                var hCss = '';
                for (var hsp in hStyles) { hCss += hsp + ': ' + hStyles[hsp] + ' !important; '; }
                if (hCss) styleTag.sheet.insertRule(hoverSel + ' { ' + hCss + '}', styleTag.sheet.cssRules.length);
              }
            }
          } else {
            if (val) el.style.setProperty(cp, val, 'important');
            else el.style.removeProperty(cp);
          }
        }
        hl.scheduleRender();
        break;
      }
      case 'PREVIEW_HOVER_STYLE': {
        if (!data?.editPath || !data?.styles) break;
        var hoverEl = findByEditPath(data.editPath);
        // 首次修改该元素时，保存原始 inline style
        if (hoverEl && !(data.editPath in origInlineStyleMap)) {
          origInlineStyleMap[data.editPath] = hoverEl.getAttribute('style') || '';
        }
        var hoverTag = document.getElementById('__editor_hover_styles__');
        if (!hoverTag) {
          hoverTag = document.createElement('style');
          hoverTag.id = '__editor_hover_styles__';
          document.head.appendChild(hoverTag);
        }
        var sheet = hoverTag.sheet;
        var hoverSelector = '[data-edit-path="' + data.editPath + '"]:hover';
        var normalSelector = '[data-edit-path="' + data.editPath + '"]';

        // Collect existing hover rules
        var hoverExistIdx = -1;
        for (var ri = 0; ri < sheet.cssRules.length; ri++) {
          if (sheet.cssRules[ri].selectorText === hoverSelector) { hoverExistIdx = ri; break; }
        }
        var existingHoverStyles = {};
        if (hoverExistIdx >= 0) {
          var existRule = sheet.cssRules[hoverExistIdx];
          for (var si = 0; si < existRule.style.length; si++) {
            var sProp = existRule.style[si];
            existingHoverStyles[sProp] = existRule.style.getPropertyValue(sProp);
          }
          sheet.deleteRule(hoverExistIdx);
        }

        // Collect existing normal rules
        var normalExistIdx = -1;
        for (var ni = 0; ni < sheet.cssRules.length; ni++) {
          if (sheet.cssRules[ni].selectorText === normalSelector) { normalExistIdx = ni; break; }
        }
        var existingNormalStyles = {};
        if (normalExistIdx >= 0) {
          var nRule = sheet.cssRules[normalExistIdx];
          for (var nsi = 0; nsi < nRule.style.length; nsi++) {
            var nProp = nRule.style[nsi];
            existingNormalStyles[nProp] = nRule.style.getPropertyValue(nProp);
          }
          sheet.deleteRule(normalExistIdx);
        }

        for (var hp in data.styles) {
          var cp = hp.replace(/([A-Z])/g, '-$1').toLowerCase();
          if (data.styles[hp]) existingHoverStyles[cp] = data.styles[hp];
          else delete existingHoverStyles[cp];

          // Move inline !important to CSS normal rule so :hover can override
          if (hoverEl && hoverEl.style.getPropertyValue(cp)) {
            existingNormalStyles[cp] = hoverEl.style.getPropertyValue(cp);
            hoverEl.style.removeProperty(cp);
          }
        }

        // Re-insert normal rule
        var normalCssText = '';
        for (var np in existingNormalStyles) {
          normalCssText += np + ': ' + existingNormalStyles[np] + ' !important; ';
        }
        if (normalCssText) sheet.insertRule(normalSelector + ' { ' + normalCssText + '}', sheet.cssRules.length);

        // Re-insert hover rule
        var hoverCssText = '';
        for (var sp in existingHoverStyles) {
          hoverCssText += sp + ': ' + existingHoverStyles[sp] + ' !important; ';
        }
        if (hoverCssText) sheet.insertRule(hoverSelector + ' { ' + hoverCssText + '}', sheet.cssRules.length);
        break;
      }
      case 'REVERT_HOVER_STYLE': {
        if (!data?.editPath || !data?.properties) break;
        var revertTag = document.getElementById('__editor_hover_styles__');
        if (!revertTag || !revertTag.sheet) break;
        var revertHoverSel = '[data-edit-path="' + data.editPath + '"]:hover';
        var propsToRemove = data.properties.map(function (p) { return p.replace(/([A-Z])/g, '-$1').toLowerCase(); });

        // Remove specified properties from hover rule
        for (var rhi = revertTag.sheet.cssRules.length - 1; rhi >= 0; rhi--) {
          if (revertTag.sheet.cssRules[rhi].selectorText === revertHoverSel) {
            var rhRule = revertTag.sheet.cssRules[rhi];
            var rhKeep = {};
            for (var rsi = 0; rsi < rhRule.style.length; rsi++) {
              var rsProp = rhRule.style[rsi];
              if (propsToRemove.indexOf(rsProp) === -1) {
                rhKeep[rsProp] = rhRule.style.getPropertyValue(rsProp);
              }
            }
            revertTag.sheet.deleteRule(rhi);
            var rhCss = '';
            for (var rkp in rhKeep) { rhCss += rkp + ': ' + rhKeep[rkp] + ' !important; '; }
            if (rhCss) revertTag.sheet.insertRule(revertHoverSel + ' { ' + rhCss + '}', revertTag.sheet.cssRules.length);
            break;
          }
        }
        break;
      }
      case 'PREVIEW_CONTENT': {
        if (!data?.editPath) break;
        const el = findByEditPath(data.editPath);
        if (!el) break;
        if (data.field === 'textContent') safeSetText(el, data.value || '');
        else if (data.field === 'src' && 'src' in el) el.src = data.value || '';
        else if (data.field === 'href' && 'href' in el) el.href = data.value || '';
        hl.scheduleRender();
        break;
      }
      case 'DELETE_ELEMENT': {
        if (!data?.editPath) break;
        const el = findByEditPath(data.editPath);
        if (!el || !isDeletable(el)) break;
        var parentEl = el.parentElement;
        var nextSib = el.nextSibling;
        if (parentEl) {
          if (!window.__deletedElements__) window.__deletedElements__ = {};
          window.__deletedElements__[data.editPath] = { element: el, parent: parentEl, nextSibling: nextSib };
          parentEl.removeChild(el);
        }
        deselectElement();
        hl.scheduleRender();
        break;
      }
      case 'RESTORE_ELEMENT': {
        if (data?.editPath) {
          var deleted = window.__deletedElements__ && window.__deletedElements__[data.editPath];
          if (deleted) {
            deleted.parent.insertBefore(deleted.element, deleted.nextSibling);
            delete window.__deletedElements__[data.editPath];
            hl.scheduleRender();
            break;
          }
          var restoreEl = findByEditPath(data.editPath);
          if (restoreEl) {
            // 还原 inline style：使用保存的原始 style attribute
            var origStyleAttr = origInlineStyleMap[data.editPath];
            if (origStyleAttr !== undefined) {
              if (origStyleAttr) restoreEl.setAttribute('style', origStyleAttr);
              else restoreEl.removeAttribute('style');
              delete origInlineStyleMap[data.editPath];
            }
            // 还原文本
            if (data.originalTextContent !== undefined) {
              safeSetText(restoreEl, data.originalTextContent);
            }
            // 还原图片 src
            if (data.originalSrc !== undefined && 'src' in restoreEl) {
              restoreEl.src = data.originalSrc;
            }
            // 还原链接 href
            if (data.originalHref !== undefined && 'href' in restoreEl) {
              restoreEl.href = data.originalHref;
            }
            // 清理注入的 hover CSS 和 normal CSS rule
            var hoverCleanTag = document.getElementById('__editor_hover_styles__');
            if (hoverCleanTag && hoverCleanTag.sheet) {
              var cleanHoverSel = '[data-edit-path="' + data.editPath + '"]:hover';
              var cleanNormalSel = '[data-edit-path="' + data.editPath + '"]';
              for (var ci = hoverCleanTag.sheet.cssRules.length - 1; ci >= 0; ci--) {
                var cSel = hoverCleanTag.sheet.cssRules[ci].selectorText;
                if (cSel === cleanHoverSel || cSel === cleanNormalSel) {
                  hoverCleanTag.sheet.deleteRule(ci);
                }
              }
            }
          }
        }
        hl.scheduleRender();
        break;
      }
      case 'DESELECT_ELEMENT': {
        // 只清视觉状态，不调 deselectElement() 避免回发 ELEMENT_DESELECTED 造成循环
        exitDirectEdit();
        removeEnterKeyListener?.();
        removeEnterKeyListener = null;
        pointerDown = false;
        activeTarget = null;
        hoverTarget = null;
        hl.setActiveTarget(null);
        hl.setHoverTarget(null);
        var prevSel = document.querySelector('[data-canvas-selected]');
        if (prevSel) prevSel.removeAttribute('data-canvas-selected');
        break;
      }
      case 'RESELECT_ELEMENT': {
        // 重新确认高亮；历史同步显式请求 echo 时回传画布真值，其他调用保持仅高亮。
        if (data && data.editPath) {
          var reEl = findByEditPath(data.editPath);
          if (reEl) {
            activeTarget = reEl;
            hl.setActiveTarget(reEl);
            if (!reEl.hasAttribute('data-canvas-selected')) {
              var prevSel2 = document.querySelector('[data-canvas-selected]');
              if (prevSel2) prevSel2.removeAttribute('data-canvas-selected');
              reEl.setAttribute('data-canvas-selected', '');
            }
            if (data.echo) {
              var refreshedData = { ...getElementData(reEl) };
              delete refreshedData.rect;
              postToHost('ELEMENT_SELECTED', {
                ...refreshedData,
                editPath: reEl.getAttribute('data-edit-path'),
              });
            }
          }
        }
        break;
      }
      case 'HIGHLIGHT_DIRTY': {
        document.querySelectorAll('[data-canvas-dirty]').forEach(function (el) {
          el.removeAttribute('data-canvas-dirty');
        });
        var hasDirty = data && Array.isArray(data.editPaths) && data.editPaths.length > 0;
        if (hasDirty) {
          data.editPaths.forEach(function (ep) {
            var el = findByEditPath(ep);
            if (el) el.setAttribute('data-canvas-dirty', '');
          });
        }
        dirtyHighlightActive = !!hasDirty;
        if (hasDirty) document.body.classList.add('dirty-highlight-mode');
        else document.body.classList.remove('dirty-highlight-mode');
        hl.scheduleRender();
        break;
      }
      case 'SCROLL_AND_HIGHLIGHT': {
        if (window.__canvasHighlightedEl) {
          window.__canvasHighlightedEl.style.removeProperty('outline');
          window.__canvasHighlightedEl.style.removeProperty('outline-offset');
          window.__canvasHighlightedEl.removeAttribute('data-canvas-highlighted');
          window.__canvasHighlightedEl = null;
          hl.scheduleRender();
        }
        var targetEl = data && data.editPath ? findByEditPath(data.editPath) : null;
        if (!targetEl) break;
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetEl.style.outline = '2px dashed rgba(249, 115, 22, 0.8)';
        targetEl.style.outlineOffset = '2px';
        targetEl.setAttribute('data-canvas-highlighted', '');
        window.__canvasHighlightedEl = targetEl;
        hl.scheduleRender();
        break;
      }
      case 'CLEAR_HIGHLIGHT': {
        if (window.__canvasHighlightedEl) {
          window.__canvasHighlightedEl.style.removeProperty('outline');
          window.__canvasHighlightedEl.style.removeProperty('outline-offset');
          window.__canvasHighlightedEl.removeAttribute('data-canvas-highlighted');
          window.__canvasHighlightedEl = null;
          hl.scheduleRender();
        }
        break;
      }
    }
  });

  // ── 缩放手势转发 ────────────────────────────────────────────────────────────
  // wheel(trackpad pinch) 和 touch(触摸屏双指) 事件不跨 iframe 冒泡，
  // 在 iframe 内监听后通过 postMessage 转发给父页面统一处理缩放。

  // trackpad pinch → wheel + ctrlKey
  document.addEventListener('wheel', function(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    window.parent.postMessage({ type: 'CANVAS_WHEEL_ZOOM', data: { deltaY: e.deltaY } }, '*');
  }, { passive: false });

  // 触摸屏双指 pinch
  var _pinchInitDist = 0;
  document.addEventListener('touchstart', function(e) {
    if (e.touches.length !== 2) return;
    var dx = e.touches[0].clientX - e.touches[1].clientX;
    var dy = e.touches[0].clientY - e.touches[1].clientY;
    _pinchInitDist = Math.sqrt(dx * dx + dy * dy);
  }, { passive: true });
  document.addEventListener('touchmove', function(e) {
    if (e.touches.length !== 2 || _pinchInitDist === 0) return;
    e.preventDefault();
    var dx = e.touches[0].clientX - e.touches[1].clientX;
    var dy = e.touches[0].clientY - e.touches[1].clientY;
    var dist = Math.sqrt(dx * dx + dy * dy);
    window.parent.postMessage({ type: 'CANVAS_PINCH_ZOOM', data: { ratio: dist / _pinchInitDist } }, '*');
    _pinchInitDist = dist; // 增量更新，避免累积误差
  }, { passive: false });
  document.addEventListener('touchend', function() { _pinchInitDist = 0; }, { passive: true });

  console.log('[Editor] Initializer complete (1:1 replica)');
})();
`;function Ke(e,t,n){try{e.contentWindow?.postMessage({type:t,data:n},"*")}catch{}}function Ci(e,t){const n=i=>{const s=e.current;!s||i.source!==s.contentWindow||i.data?.type&&t(i.data)};return window.addEventListener("message",n),()=>{window.removeEventListener("message",n)}}var o=ir(Zr(),1);Oe();Qr();kt();fi();vi();var r=ir(Jr(),1),Ti={ALLOWED_TAGS:["p","div","span","h1","h2","h3","h4","h5","h6","br","hr","strong","b","em","i","u","strike","del","a","img","table","thead","tbody","tr","td","th","ul","ol","li","blockquote","code","pre","sup","sub","small","mark","abbr","cite","dfn","kbd","samp","var","time","address","article","aside","figcaption","figure","footer","header","main","nav","section","details","summary","svg","path","circle","rect","line","polyline","polygon","ellipse","g","text","tspan","defs","use","symbol","view","linearGradient","stop","style","script","noscript","iframe"],ALLOWED_ATTR:["href","target","rel","title","alt","src","width","height","class","id","style","data-*","role","aria-*","lang","dir","cite","datetime","name","value","type","start","reversed","colspan","rowspan","headers","scope","d","fill","stroke","stroke-width","viewBox","xmlns","x","y","cx","cy","r","rx","ry","x1","y1","x2","y2","points","transform","clip-path","mask","filter","opacity","fill-opacity","stroke-opacity","stroke-linecap","stroke-linejoin","stroke-dasharray","stroke-dashoffset","font-size","font-family","font-weight","text-anchor","dominant-baseline","xml:space","preserveAspectRatio","onclick","ondblclick","onmousedown","onmouseup","onmouseover","onmousemove","onmouseout","onkeydown","onkeypress","onkeyup","onfocus","onblur","onchange","onsubmit","onreset","onselect","onload","onerror","onresize","onscroll","onpageshow","onpagehide"],ALLOWED_URI_REGEXP:/^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|xxx|sms|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,FORCE_BODY:!0,SANITIZE_DOM:!0,ALLOW_DATA_ATTR:!0,USE_PROFILES:{html:!0,svg:!0,svgFilters:!0}};function Si(e,t,n="Preview"){return`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${n}</title>
  <style></style>
  ${t?`<style>${t}</style>`:""}
</head>
<body>
  ${e}
</body>
</html>`}function ki(){return function(t,n){let i=null;return function(...s){i&&clearTimeout(i),i=setTimeout(()=>t(...s),n)}}}async function _i(e,t,n){const i=await e.arrayBuffer(),s=e.type||"image/png";if(s&&!xi.includes(s))throw new Error(`unsupported image type: ${s}`);const c=new Blob([i],{type:s}),h=new File([c],t||"image.png",{type:s}),v=await n(),u=(await mi(h,void 0,v?{baseUrl:v.url,password:v.password}:void 0))?.data?.fileUrl;if(!u)throw new Error("image upload response missing fileUrl");return u}function Ri(){return(0,r.jsxs)("svg",{className:"animate-spin h-6 w-6 text-zinc-400",xmlns:"http://www.w3.org/2000/svg",fill:"none",viewBox:"0 0 24 24",children:[(0,r.jsx)("circle",{className:"opacity-25",cx:"12",cy:"12",r:"10",stroke:"currentColor",strokeWidth:"4"}),(0,r.jsx)("path",{className:"opacity-75",fill:"currentColor",d:"M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"})]})}const zn=(0,o.forwardRef)(function(t,n){const{html:i="",src:s,className:c,style:h,enableSanitize:v=!1,sanitizeConfig:u,iframeStyle:w,iframeClassName:E,customStyles:l,onLoad:f,onError:y,trackingContext:_=_t,showLoading:I=!0,loadingComponent:b,title:g="Preview",sandbox:k,editable:N=!1,editing:U,deviceType:R="mobile",onModeChange:ee,onDeviceChange:ie,onPublish:de,onEditStateChange:Ee,onHtmlChange:lt,onDomChanges:K,applyLoading:dt=!1,externalPanel:$=!1,onElementSelected:ct,onElementDeselected:Rt,onRenderErrorChange:qe,onPreviewLinkClick:Xe}=t,{t:x}=ve("webBuilder"),{getGatewayInfoForUpload:oe}=gi(),[It,ce]=(0,o.useState)(!0),[Ze,ut]=(0,o.useState)(!1),[_e,Pt]=(0,o.useState)("");(0,o.useEffect)(()=>{ce(!0);const m=setTimeout(()=>ce(!1),s?15e3:5e3);return()=>clearTimeout(m)},[s,i]);const ht=U??N,[He,Lt]=(0,o.useState)(ht?"edit":"preview");(0,o.useEffect)(()=>{Lt(ht?"edit":"preview")},[ht]);const[Ve,At]=(0,o.useState)(R),[Ut,Gt]=(0,o.useState)({hasUnsavedChanges:!1,editCount:0,canUndo:!1,canRedo:!1}),$e=(0,o.useRef)(null),Je=(0,o.useRef)(null),Qe=(0,o.useRef)(Xe);Qe.current=Xe,(0,o.useEffect)(()=>{if(!qe)return;const m=M=>{const O=$e.current;if(O&&M.source!==O.contentWindow)return;const j=M.data;!j||j.type!=="ACCIO_VITE_OVERLAY"||qe(!!j.data?.hasError)};return window.addEventListener("message",m),()=>{window.removeEventListener("message",m),qe(!1)}},[qe]);const we=(0,o.useRef)(null),ue=(0,o.useRef)({..._,protocol:s?.startsWith("file://")?"file":"http",hasCustomStyles:!!l});ue.current={..._,protocol:s?.startsWith("file://")?"file":"http",hasCustomStyles:!!l},(0,o.useImperativeHandle)(n,()=>({sendMessage(m,M){const O=$e.current;O&&Ke(O,m,M)},getIframe(){return $e.current}}),[]);const he=(0,o.useCallback)(()=>$e,[]);(0,o.useEffect)(()=>()=>{Je.current?.(),Je.current=null},[]);const xe=(0,o.useRef)(new Map);(0,o.useEffect)(()=>{N||xe.current.clear()},[N]);const Re=(0,o.useMemo)(()=>{if(!v)return i;try{const m={...Ti,...u};return yi.sanitize(i,m)}catch(m){return y?.(m),ut(!0),Pt("HTML sanitization failed."),""}},[i,v,u,y]),Ie=(0,o.useMemo)(()=>{if(!N)return"";const m={describeChangePlaceholder:x("htmlEditor.editorDescribePlaceholder"),undoTitle:x("htmlEditor.editorUndo"),redoTitle:x("htmlEditor.editorRedo"),discardBtn:x("htmlEditor.editorDiscard"),applyBtn:x("htmlEditor.editorApply"),applyingBtn:x("htmlEditor.editorApplying"),styleTab:x("htmlEditor.editorStyleTab"),layoutTab:x("htmlEditor.editorLayoutTab"),closeTitle:x("action.close",{ns:"common"}),saveAndCloseTitle:x("htmlEditor.editorSaveAndClose"),editorConfirm:x("htmlEditor.editorConfirm"),content:{textContentLabel:x("htmlEditor.editorTextLabel"),textContentPlaceholder:x("htmlEditor.editorTextPlaceholder"),imageSourceLabel:x("htmlEditor.editorImageLabel"),imageSourcePlaceholder:"https://",linkUrlLabel:x("htmlEditor.editorLinkLabel"),linkUrlPlaceholder:"https://"},style:{colors:x("htmlEditor.editorColors"),typography:x("htmlEditor.editorTypography"),fontSize:x("htmlEditor.editorFontSize"),fontWeight:x("htmlEditor.editorFontWeight"),fontStyle:x("htmlEditor.editorFontStyle"),text:x("htmlEditor.editorTextLabel"),align:x("htmlEditor.editorTextAlign"),decoration:x("htmlEditor.editorDecoration"),display:x("htmlEditor.editorDisplay"),other:x("htmlEditor.editorOther"),objectFit:x("htmlEditor.editorObjectFit"),opacity:x("htmlEditor.editorOpacity")},layout:{padding:x("htmlEditor.editorPadding"),margin:x("htmlEditor.editorMargin"),size:x("htmlEditor.editorSize"),border:x("htmlEditor.editorBorder"),top:x("htmlEditor.editorTop"),right:x("htmlEditor.editorRight"),bottom:x("htmlEditor.editorBottom"),left:x("htmlEditor.editorLeft"),width:x("htmlEditor.editorWidth"),height:x("htmlEditor.editorHeight"),borderWidth:x("htmlEditor.editorBorderWidth"),borderRadius:x("htmlEditor.editorBorderRadius"),borderStyle:x("htmlEditor.editorBorderStyle")},cards:{deleted:x("htmlEditor.editorCardDeleted"),styleChange:x("htmlEditor.editorCardStyleChange")}};return`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${Vn}</style>
</head>
<body>
  ${Re}

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
        <button class="b-dis" id="disBtn" disabled onclick="doDiscard()">${m.discardBtn}</button>
        <button class="b-app" id="appBtn" disabled onclick="doApply()">${m.applyBtn}</button>
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
            <textarea class="si-comment" id="siComment" rows="1" placeholder="${m.describeChangePlaceholder}"></textarea>
          </div>
          <div class="si-panel-actions">
            <button class="si-confirm-btn" id="siConfirmBtn" onclick="confirmSI()">${m.editorConfirm}</button>
            <button class="si-close-btn" id="siCloseBtn" title="${m.closeTitle}">
              <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="11" y2="11"/><line x1="11" y1="1" x2="1" y2="11"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div class="si-content-area hidden" id="siContentArea"></div>
      <div class="si-tabs">
        <button class="si-tab active" id="siTabStyle" onclick="setSITab('styles')">${m.styleTab}</button>
        <button class="si-tab" id="siTabLayout" onclick="setSITab('spacing')">${m.layoutTab}</button>
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

  <script>${$n}<\/script>
  <script>window.__BA_EDITOR_LOC__ = ${JSON.stringify(m)};<\/script>
  <script>${Wn}<\/script>
</body>
</html>`},[N,Re,x]);(0,o.useEffect)(()=>{(s||Ie||Re)&&(we.current=performance.now())},[s,Ie,Re]);const Ce=!!(N&&s),Kt=(0,o.useMemo)(()=>{if(!s)return N?Ie:Si(Re,l,g)},[s,N,Ie,Re,l,g]),et=(0,o.useRef)(null),Te=(0,o.useRef)({mode:He,device:Ve,externalPanel:$});Te.current={mode:He,device:Ve,externalPanel:$};const ft=(0,o.useRef)(x);ft.current=x;const tt=(0,o.useRef)(null),pt=(0,o.useCallback)(()=>{const m=ft.current;return{describeChangePlaceholder:m("htmlEditor.editorDescribePlaceholder"),undoTitle:m("htmlEditor.editorUndo"),redoTitle:m("htmlEditor.editorRedo"),discardBtn:m("htmlEditor.editorDiscard"),applyBtn:m("htmlEditor.editorApply"),applyingBtn:m("htmlEditor.editorApplying"),styleTab:m("htmlEditor.editorStyleTab"),layoutTab:m("htmlEditor.editorLayoutTab"),closeTitle:m("action.close",{ns:"common"}),saveAndCloseTitle:m("htmlEditor.editorSaveAndClose"),editorConfirm:m("htmlEditor.editorConfirm"),content:{textContentLabel:m("htmlEditor.editorTextLabel"),textContentPlaceholder:m("htmlEditor.editorTextPlaceholder"),imageSourceLabel:m("htmlEditor.editorImageLabel"),imageSourcePlaceholder:"https://",linkUrlLabel:m("htmlEditor.editorLinkLabel"),linkUrlPlaceholder:"https://"},style:{colors:m("htmlEditor.editorColors"),typography:m("htmlEditor.editorTypography"),fontSize:m("htmlEditor.editorFontSize"),fontWeight:m("htmlEditor.editorFontWeight"),fontStyle:m("htmlEditor.editorFontStyle"),text:m("htmlEditor.editorTextLabel"),align:m("htmlEditor.editorTextAlign"),decoration:m("htmlEditor.editorDecoration"),display:m("htmlEditor.editorDisplay"),other:m("htmlEditor.editorOther"),objectFit:m("htmlEditor.editorObjectFit"),opacity:m("htmlEditor.editorOpacity")},layout:{padding:m("htmlEditor.editorPadding"),margin:m("htmlEditor.editorMargin"),size:m("htmlEditor.editorSize"),border:m("htmlEditor.editorBorder"),top:m("htmlEditor.editorTop"),right:m("htmlEditor.editorRight"),bottom:m("htmlEditor.editorBottom"),left:m("htmlEditor.editorLeft"),width:m("htmlEditor.editorWidth"),height:m("htmlEditor.editorHeight"),borderWidth:m("htmlEditor.editorBorderWidth"),borderRadius:m("htmlEditor.editorBorderRadius"),borderStyle:m("htmlEditor.editorBorderStyle")},cards:{deleted:m("htmlEditor.editorCardDeleted"),styleChange:m("htmlEditor.editorCardStyleChange")}}},[]),Pe=(0,o.useCallback)(m=>{try{m.contentWindow?.postMessage({type:"ACCIO_INJECT_EDITOR",bundle:$n,init:Wn,css:Vn,loc:pt(),debounce:!0},"*")}catch{}},[pt]),jt=(0,o.useCallback)(m=>{try{m.contentWindow?.postMessage({type:"ACCIO_REINIT_EDITOR"},"*")}catch{}},[]);(0,o.useEffect)(()=>{et.current=m=>{tt.current=m,Pe(m)}},[Pe]);const Le=(0,o.useRef)(null);(0,o.useEffect)(()=>{if(Ce)return()=>{try{Le.current?.()}catch{}Le.current=null}},[Ce]),(0,o.useEffect)(()=>{if(!Ce)return;const m=M=>{const O=M.data?.type;if(!O)return;const j=tt.current;if(j){if(O==="ACCIO_BOOTSTRAP_READY"){Pe(j);return}if(O==="ACCIO_EDITOR_READY"){window.editorIframe=j,Ke(j,"INIT",Te.current);return}}};return window.addEventListener("message",m),()=>window.removeEventListener("message",m)},[Ce,Pe]),(0,o.useEffect)(()=>{if(Ce)return()=>{try{Le.current?.()}catch{}Le.current=null}},[Ce,jt]);const ye=(0,o.useCallback)(()=>{f?.(),setTimeout(()=>{ce(!1);const m=performance.now(),M=we.current?Math.round(m-we.current):0;Ct("accio_website.html_editor_load",{...ue.current,editable:String(N),loadTimeMs:String(M)});const O=he().current;if(O){Je.current?.(),Je.current=null;{let j=null;try{j=O.contentDocument}catch{j=null}if(j){const ae=j,G=A=>{const Z=A.target,Y=(Z?.closest?.("a[href]")??Z?.parentElement?.closest?.("a[href]"))?.getAttribute("href")?.trim();if(Y){if(wi(ae,Y)){A.preventDefault(),A.stopPropagation();return}Qe.current?.(Y)&&(A.preventDefault(),A.stopPropagation())}};ae.addEventListener("click",G,!0),Je.current=()=>{ae.removeEventListener("click",G,!0)}}}if(Ce){et.current?.(O);try{Le.current?.()}catch{}Le.current=null;return}if(N){O.contentWindow.__BA_debounce__=ki(),window.editorIframe=O;const j=window;if(j.phoenixAPI?.opener?.httpRequest){const ae=O.contentWindow;ae.phoenixAPI={opener:{httpRequest:j.phoenixAPI.opener.httpRequest}};const G=`
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
                    if (!result.success) throw new Error(result.error || 'Request failed');
                    return {
                      ok: result.status >= 200 && result.status < 300,
                      status: result.status,
                      json: () => Promise.resolve(result.data),
                      text: () => Promise.resolve(typeof result.data === 'string' ? result.data : JSON.stringify(result.data)),
                    };
                  }).catch((err) => { console.error('[Iframe] Request failed:', err); throw err; });
                }
                return originalFetch.apply(this, arguments);
              };
            }`;O.contentWindow.__injectFetchWrapper=G,O.contentWindow?.eval(G)}Ke(O,"INIT",{mode:He,device:Ve,externalPanel:$})}}},500)},[N,Ce,he,He,Ve,$,f]),gt=(0,o.useCallback)(()=>{ce(!1),ut(!0);const m="Failed to load preview.";Pt(m),y?.(new Error(m)),Ct("accio_website.html_editor_error",{...ue.current,editable:String(N),errorType:"load_failed"})},[y,N]);(0,o.useEffect)(()=>{if(N)return Ci($e,m=>{switch(m.type){case"EDIT_STATE_CHANGE":{const M=m.data;Gt(M),Ee?.(M),M.editCount===0&&xe.current.clear();break}case"HTML_CHANGED":{const M=m.data,O=M.html;let j=M.domChanges;const ae=Array.isArray(j)?j.length:0;if(pi("accio_website.html_apply_clk",{...ue.current,changeCount:String(ae),hasUnsavedChanges:String(Ut.hasUnsavedChanges)}),Array.isArray(j)){const G=new Map;j.forEach(A=>{const Z=A.srcLoc||A.selector||"unknown";if(!G.has(Z))G.set(Z,{...A});else{const Y=G.get(Z),F={...Y,currentOuterHtml:A.currentOuterHtml,changes:{...Y.changes}};A.changes.textContent&&(F.changes.textContent={original:Y.changes.textContent?.original||A.changes.textContent.original,modified:A.changes.textContent.modified}),A.changes.style&&(F.changes.style={...Y.changes.style},Object.entries(A.changes.style).forEach(([re,H])=>{F.changes.style[re]={original:Y.changes.style?.[re]?.original||H.original,modified:H.modified}})),A.changes.comment&&(F.changes.comment={original:Y.changes.comment?.original||A.changes.comment.original,modified:A.changes.comment.modified}),A.changes.src&&(F.changes.src={original:Y.changes.src?.original||A.changes.src.original,modified:A.changes.src.modified}),A.changes.href&&(F.changes.href={original:Y.changes.href?.original||A.changes.href.original,modified:A.changes.href.modified}),A.changes.deleted&&(F.changes.deleted=A.changes.deleted),G.set(Z,F)}}),j=Array.from(G.values()).map(A=>{const Z=A.srcLoc||A.selector||"unknown";if(!xe.current.has(Z)){const re={};A.changes.textContent&&(re.textContent=A.changes.textContent.original),A.changes.style&&(re.style={},Object.entries(A.changes.style).forEach(([H,Ae])=>{re.style[H]=Ae.original})),xe.current.set(Z,re)}const Y=xe.current.get(Z),F={...A,changes:{...A.changes}};if(F.changes.textContent&&Y.textContent!==void 0&&(F.changes.textContent={original:Y.textContent,modified:F.changes.textContent.modified}),F.changes.style&&Y.style){const re={};Object.entries(F.changes.style).forEach(([H,Ae])=>{const mt=Y.style[H];re[H]={original:mt!==void 0?mt:Ae.original,modified:Ae.modified}}),F.changes.style=re}return F})}K&&K(Array.isArray(j)?j:[],O),lt?.(O),de?.();break}case"MODE_CHANGED":{const{mode:M}=m.data;Lt(M),ee?.(M),Ct("accio_website.html_mode_change",{...ue.current,newMode:M});break}case"DEVICE_CHANGED":{const{device:M}=m.data;At(M),ie?.(M),Ct("accio_website.html_device_change",{...ue.current,newDevice:M});break}case"IMAGE_UPLOAD_REQUEST":{const M=he().current,O=m.data,j=O?.requestId,ae=O?.file;if(!M||!j)break;if(!(ae instanceof Blob)){Ke(M,"IMAGE_UPLOAD_RESULT",{requestId:j,success:!1,error:"missing upload file"});break}_i(ae,O.fileName,oe).then(G=>{Ke(M,"IMAGE_UPLOAD_RESULT",{requestId:j,success:!0,imgUrl:G})}).catch(G=>{Ct("accio_website.html_image_upload_fail",{...ue.current,errorType:"upload_failed"}),Ke(M,"IMAGE_UPLOAD_RESULT",{requestId:j,success:!1,error:G instanceof Error?G.message:String(G)})});break}case"ELEMENT_SELECTED":ct?.(m.data);break;case"ELEMENT_DESELECTED":Rt?.();break}})},[N,oe,he,Ee,lt,K,ee,ie,de,ct,Rt]),(0,o.useEffect)(()=>{if(!N)return;const m=he().current;m&&Ke(m,"SET_APPLY_LOADING",{loading:dt})},[dt,N,he]);const We=(0,o.useMemo)(()=>{const m=k!==void 0?k:!s;if(m!==!1)return m===!0?"allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts":m},[k,s]);return Ze?(0,r.jsxs)("div",{className:an("flex flex-col items-center justify-center p-6 min-h-[100px]","bg-red-50 border border-red-200 rounded",c),style:h,children:[(0,r.jsx)("div",{className:"text-2xl mb-2",children:"⚠️"}),(0,r.jsx)("div",{className:"text-red-700 text-sm",children:_e})]}):(0,r.jsxs)("div",{className:an("relative",c),style:{flex:1,height:"100%",...h},children:[(0,r.jsx)("iframe",{ref:$e,...s?{src:s}:{srcDoc:Kt},style:{width:"100%",height:"100%",border:"none",...w},className:an("block w-full border-none bg-white",E),title:g,sandbox:We,onLoad:ye,onError:gt}),I&&It&&(0,r.jsx)("div",{className:"absolute inset-0 flex items-center justify-center bg-bg-container z-10",children:b??(0,r.jsx)(Ri,{})})]})});var dn=new Set(["SCRIPT","STYLE","NOSCRIPT","TEMPLATE","SVG","META","TITLE","LINK","BASE","CANVAS"]);function dr(e,t){if(dn.has(e.tagName))return;const n=t.join("-");e.setAttribute("data-edit-path",n);let i=0;for(let s=0;s<e.children.length;s++){const c=e.children[s];dn.has(c.tagName)||(dr(c,[...t,String(i)]),i++)}}function Ii(e){const t=e.body;if(!t)return;let n=0;for(let i=0;i<t.children.length;i++){const s=t.children[i];dn.has(s.tagName)||(dr(s,[String(n)]),n++)}}function Pi(e,t){return t==="__page__"?e.body:e.querySelector(`[data-edit-path="${t}"]`)}function Li(e){return e.replace(/([A-Z])/g,"-$1").toLowerCase()}function Ai(e,t){if(e.children.length===0){e.textContent=t;return}const n=Array.from(e.childNodes).filter(i=>i.nodeType===3);if(n.length>0){n[0].textContent=t;for(let i=1;i<n.length;i++)e.removeChild(n[i])}else e.insertBefore(e.ownerDocument.createTextNode(t),e.firstChild)}function Zo(e,t,n){if(!/<html[\s>]/i.test(e))return{html:e,failedIds:[...new Set(t.map(h=>h.id))]};const i=new DOMParser().parseFromString(e,"text/html");Ii(i);const s=[],c=new Map;for(const h of t){if(c.has(h.id)||s.includes(h.id))continue;const v=Pi(i,h.id),u=n?.get(h.id);v?u&&v.tagName.toUpperCase()!==u.toUpperCase()?s.push(h.id):c.set(h.id,v):s.push(h.id)}for(const h of t){const v=c.get(h.id);if(v)switch(h.kind){case"set-style":for(const[u,w]of Object.entries(h.styles)){const E=Li(u);w?v.style.setProperty(E,w):v.style.removeProperty(E)}break;case"set-text":Ai(v,h.value);break;case"set-src":v.setAttribute("src",h.value);break;case"set-href":v.setAttribute("href",h.value);break;case"remove-element":if(h.id==="__page__"){s.includes(h.id)||s.push(h.id);break}v.parentElement?.removeChild(v);break;default:s.includes(h.id)||s.push(h.id)}}return{html:ji(i),failedIds:s}}function ji(e){for(const n of Array.from(e.querySelectorAll("[data-edit-path]")))n.removeAttribute("data-edit-path");const t=e.doctype;return(t?`<!DOCTYPE ${t.name}${t.publicId?` PUBLIC "${t.publicId}"`:""}${t.systemId?t.publicId?` "${t.systemId}"`:` SYSTEM "${t.systemId}"`:""}>
`:"")+e.documentElement.outerHTML}function Ni(e){const t=new Map,n=[];for(const i of e){if(i.kind==="nl-instruction"){n.push(i);continue}const s=i.kind==="set-hover-style"?`${i.id}::hover-style`:`${i.id}::${i.kind}`,c=t.get(s);if(!c){t.set(s,{...i});continue}if(i.kind==="remove-element"){for(const h of[...t.keys()])h.startsWith(`${i.id}::`)&&t.delete(h);t.set(s,i);continue}if(i.kind==="set-style"&&c.kind==="set-style"){t.set(s,{...c,styles:{...c.styles,...i.styles}});continue}if(i.kind==="set-hover-style"&&c.kind==="set-hover-style"){t.set(s,{...c,styles:{...c.styles,...i.styles}});continue}t.set(s,{...i})}return[...n,...Array.from(t.values())]}function Di(e,t){if(!t)return e;try{return new URL(e,t).href}catch{return e}}function un(e,t,n){return Math.min(n,Math.max(t,e))}function Bi(e){const t=e.match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i);if(!t)return null;let n=t[1];n.length<=4&&(n=[...n].map(s=>s+s).join(""));const i=n.length===8;return{r:parseInt(n.slice(0,2),16),g:parseInt(n.slice(2,4),16),b:parseInt(n.slice(4,6),16),a:i?parseInt(n.slice(6,8),16)/255:1}}function Mi(e){const t=parseFloat(e);return Number.isFinite(t)?un(e.endsWith("%")?t/100*255:t,0,255):null}function Oi(e){if(e===void 0)return 1;const t=parseFloat(e);return Number.isFinite(t)?un(e.endsWith("%")?t/100:t,0,1):null}function Hi(e){const t=e.match(/^rgba?\((.*)\)$/i);if(!t)return null;const n=t[1].trim().split("/").map(u=>u.trim());if(n.length>2)return null;const i=n[0].split(",").map(u=>u.trim()),s=i.length>1?i.slice(0,3):n[0].split(/\s+/),c=n[1]??(i.length===4?i[3]:void 0);if(s.length!==3)return null;const h=s.map(Mi),v=Oi(c);return h.some(u=>u===null)||v===null?null:{r:Math.round(h[0]),g:Math.round(h[1]),b:Math.round(h[2]),a:v}}function Vi(e){if(typeof document>"u")return null;const t=document.createElement("canvas");t.width=1,t.height=1;const n=t.getContext("2d",{willReadFrequently:!0});if(!n||typeof CSS<"u"&&!CSS.supports("color",e))return null;n.fillStyle="#010203",n.fillStyle=e;const i=n.fillStyle;if(n.fillStyle="#040506",n.fillStyle=e,n.fillStyle!==i)return null;n.clearRect(0,0,1,1),n.fillRect(0,0,1,1);const[s,c,h,v]=n.getImageData(0,0,1,1).data;return{r:s,g:c,b:h,a:v/255}}function hn(e){if(!e)return null;const t=e.trim();return t.toLowerCase()==="transparent"?{r:0,g:0,b:0,a:0}:Bi(t)??Hi(t)??Vi(t)}function $i({r:e,g:t,b:n}){return`#${[e,t,n].map(i=>i.toString(16).padStart(2,"0")).join("")}`}function fn(e){const t=hn(e);return{hex:t?$i(t):"#000000",alphaPercent:(t?.a??1)*100,rgbDisplay:t?`rgb(${t.r},${t.g},${t.b})`:""}}function Wi(e){return fn(e).hex}function zi(e){return fn(e).alphaPercent}function cn(e,t){const n=hn(e)??{r:0,g:0,b:0,a:1},i=Number((un(t,0,100)/100).toPrecision(12));return i>=1?Wi(e):`rgba(${n.r}, ${n.g}, ${n.b}, ${i})`}function Fn(e,t){const n=zi(t);if(n===0||n>=100){const i=hn(e)??{r:0,g:0,b:0,a:1};return`rgb(${i.r}, ${i.g}, ${i.b})`}return cn(e,n)}Oe();function Fi(e){if(!e)return"";const t=parseFloat(e);return Number.isFinite(t)?String(Math.round(t)):e}var cr=new Set(["marginTop","marginRight","marginBottom","marginLeft","letterSpacing"]);function Un(e,t){if(!t)return"";if(cr.has(e))return t+"px";const n=parseFloat(t);return Number.isFinite(n)?(n<0?"0":t)+"px":""}function ne(e,t,n,i){return{value:Fi(t),onChange:s=>n(e,Un(e,s)),onPreview:i?s=>i(e,Un(e,s)):void 0,min:cr.has(e)?void 0:0}}function Gn(e){if(e==="")return"";const t=parseInt(e);return Number.isNaN(t)?null:String(1-Math.max(0,Math.min(100,t))/100)}var Ui="#1ead6f";function Gi({children:e}){return(0,r.jsx)("div",{className:"px-4 pt-4 pb-2 text-[12px] font-semibold text-foreground",children:e})}function Be({title:e,children:t}){return(0,r.jsxs)("div",{className:"px-4 pt-0 pb-4",children:[(0,r.jsx)("div",{className:"mb-4 border-t border-foreground/5"}),(0,r.jsx)("div",{className:"mb-3 text-[12px] font-semibold text-foreground",children:e}),(0,r.jsx)("div",{className:"space-y-3",children:t})]})}function Ki({children:e}){return(0,r.jsx)("div",{className:"text-[10px] font-medium text-muted-foreground mb-1 font-[inherit]",children:e})}function be({children:e}){return(0,r.jsx)("div",{className:"grid grid-cols-2 gap-2",children:e})}function D({label:e,children:t}){return(0,r.jsxs)("div",{children:[(0,r.jsx)(Ki,{children:e}),t]})}function Yi(){let e="",t=!1;return{type(n){e=n,t=!0},commit(){return t?(t=!1,e):null}}}function Q({value:e,onChange:t,onPreview:n,suffix:i="px",min:s,max:c,step:h}){const v=(0,o.useRef)(Yi()),u=()=>{const w=v.current.commit();w!==null&&t(w)};return(0,r.jsxs)("div",{className:"flex items-center h-[30px] rounded-md border border-border bg-foreground/[0.03] px-2 transition-colors focus-within:border-primary/60",children:[(0,r.jsx)("input",{type:"number",className:"flex-1 min-w-0 text-[10px] font-mono tabular-nums bg-transparent outline-none text-foreground [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",value:e,onChange:w=>{if(!n){t(w.target.value);return}v.current.type(w.target.value),n(w.target.value)},onBlur:n?()=>u():void 0,onKeyDown:n?w=>{w.key==="Enter"&&u()}:void 0,min:s,max:c,step:h}),i&&(0,r.jsx)("span",{className:"text-[10px] text-muted-foreground ml-1 shrink-0",children:i})]})}function ke({value:e,onChange:t,options:n}){return(0,r.jsxs)("div",{className:"relative",children:[(0,r.jsx)("select",{className:"h-[30px] w-full appearance-none rounded-md border border-border bg-foreground/[0.03] pl-2 pr-7 text-[10px] font-[inherit] text-foreground outline-none transition-colors focus:border-primary/60",value:e,onChange:i=>t(i.target.value),children:n.map(i=>{const s=typeof i=="string"?i:i.value;return(0,r.jsx)("option",{value:s,children:typeof i=="string"?i:i.label},s)})}),(0,r.jsx)("svg",{width:"10",height:"10",viewBox:"0 0 10 10",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round",className:"pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground",children:(0,r.jsx)("polyline",{points:"2 3.5 5 6.5 8 3.5"})})]})}var qi=[{value:"left",title:"Left",path:"M3 6h18M3 12h12M3 18h18"},{value:"center",title:"Center",path:"M3 6h18M6 12h12M3 18h18"},{value:"right",title:"Right",path:"M3 6h18M9 12h12M3 18h18"},{value:"justify",title:"Justify",path:"M3 6h18M3 12h18M3 18h18"}];function Xi({value:e,onChange:t}){const n=e==="start"?"left":e;return(0,r.jsx)("div",{className:"flex gap-0.5",children:qi.map(i=>{const s=n===i.value;return(0,r.jsx)("button",{type:"button",title:i.title,onClick:()=>t(i.value),className:`flex h-[30px] w-[30px] items-center justify-center rounded-md border transition-colors ${s?"border-primary/50 text-primary bg-primary/5":"border-transparent bg-foreground/[0.03] text-muted-foreground hover:text-foreground hover:bg-foreground/5"}`,children:(0,r.jsx)("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",children:(0,r.jsx)("path",{d:i.path})})},i.value)})})}function Ye({value:e,onChange:t,onPreview:n,placeholder:i}){const s=!e,c=(0,o.useMemo)(()=>fn(e),[e]),h=s?"#000000":c.hex,v=s?100:Math.round(c.alphaPercent),u=s?"":c.rgbDisplay,w=(0,o.useRef)(null),E=n||t,l=(0,o.useRef)(!1),f=(0,o.useRef)(!1),y=()=>{l.current=!1,w.current?.click()};(0,o.useEffect)(()=>{const b=w.current;if(!b||!n)return;const g=()=>{l.current=!0,t(Fn(b.value,e))};return b.addEventListener("change",g),()=>b.removeEventListener("change",g)},[n,t,e]);const _=s||v===0?{backgroundImage:"linear-gradient(45deg, rgba(0,0,0,0.12) 25%, transparent 25%), linear-gradient(-45deg, rgba(0,0,0,0.12) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(0,0,0,0.12) 75%), linear-gradient(-45deg, transparent 75%, rgba(0,0,0,0.12) 75%)",backgroundSize:"8px 8px",backgroundPosition:"0 0, 0 4px, 4px -4px, -4px 0"}:{background:u||h},I=s?i??"—":u||h;return(0,r.jsxs)("div",{className:"flex items-center h-8 rounded-md border border-border bg-foreground/[0.03] px-1.5 transition-colors focus-within:border-primary/60 hover:border-primary/40",children:[(0,r.jsx)("button",{type:"button",className:"relative w-4 h-4 shrink-0 rounded border border-foreground/10 cursor-pointer transition-transform hover:scale-105 active:scale-95",style:_,onClick:y,"aria-label":"pick color",children:(0,r.jsx)("input",{ref:w,type:"color",className:"absolute inset-0 w-full h-full opacity-0 cursor-pointer",value:h,onChange:b=>{if(l.current){l.current=!1;return}E(Fn(b.target.value,e))}})}),(0,r.jsx)("button",{type:"button",className:"flex-1 min-w-0 h-full flex items-center pl-2 text-[10px] font-mono text-left text-foreground cursor-pointer",onClick:y,children:(0,r.jsx)("span",{className:"truncate",children:I})}),(0,r.jsx)("div",{className:"shrink-0 w-px h-4 bg-border ml-2 mr-0.5"}),(0,r.jsxs)("div",{className:"relative shrink-0 w-[32px]",children:[(0,r.jsx)("input",{type:"number",className:"w-full h-6 bg-transparent pr-3.5 text-[10px] font-mono text-muted-foreground text-right outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",value:s?"":100-v,placeholder:"-",min:0,max:100,onChange:b=>{f.current=!0,E(cn(h,100-(parseInt(b.target.value)||0)))},onBlur:b=>{if(n){if(!f.current)return;f.current=!1,t(cn(h,100-(parseInt(b.target.value)||0)))}}}),(0,r.jsx)("span",{className:"pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground",children:"%"})]})]})}function Zi({style:e,onStylePreview:t,onStyleChange:n}){const{t:i}=ve("webBuilder");return(0,r.jsx)("div",{className:"py-1",children:(0,r.jsxs)("div",{className:"px-4 py-3 space-y-3",children:[(0,r.jsx)(D,{label:i("htmlEditor.inspectorBackground",{defaultValue:"Background"}),children:(0,r.jsx)(Ye,{value:e.backgroundColor||"",onChange:s=>n("backgroundColor",s),onPreview:t?s=>t("backgroundColor",s):void 0})}),(0,r.jsx)(D,{label:i("htmlEditor.inspectorFont",{defaultValue:"Font"}),children:(0,r.jsx)(ke,{value:e.fontFamily||"inherit",onChange:s=>n("fontFamily",s),options:["inherit","-apple-system","Arial","Helvetica","Georgia","Times New Roman","Courier New","monospace","sans-serif","serif"]})}),(0,r.jsx)(D,{label:i("htmlEditor.inspectorBaseSize",{defaultValue:"Base size"}),children:(0,r.jsx)(Q,{...ne("fontSize",e.fontSize,n,t)})})]})})}function Ji({elementData:e,onStylePreview:t,onStyleChange:n,onHoverStylePreview:i,onHoverStyleChange:s,onContentPreview:c,onContentChange:h,onDelete:v,showImagePreview:u,imagePreviewBaseUrl:w,onCommitExit:E}){const{t:l}=ve("webBuilder"),f=e.style,[y,_]=(0,o.useState)({colors:!0,typography:!0,border:!0,display:!0,padding:!0,margin:!0,dimensions:!0,flexgrid:!0}),I=g=>_(k=>({...k,[g]:!k[g]})),b=g=>k=>{k.key==="Enter"&&(k.preventDefault(),h(g,k.currentTarget.value),E?.())};return(0,r.jsxs)("div",{className:"pb-4",children:[e.isText&&(0,r.jsxs)(r.Fragment,{children:[(0,r.jsx)(Gi,{children:l("htmlEditor.sectionTextContent",{defaultValue:"Text content"})}),(0,r.jsx)("div",{className:"px-4 pb-3",children:(0,r.jsx)("input",{type:"text",className:"w-full h-[30px] rounded-md border border-border bg-foreground/[0.03] px-2.5 text-[10px] font-[inherit] text-foreground outline-none transition-colors focus:border-primary/60",value:e.textContent||"",onChange:g=>c("textContent",g.target.value),onBlur:g=>h("textContent",g.target.value),onKeyDown:b("textContent")})})]}),e.isImage&&(0,r.jsxs)("div",{className:"px-4 pb-3",children:[(0,r.jsx)("div",{className:"mb-3 border-t border-foreground/5"}),u&&e.src&&(0,r.jsx)("div",{className:"mb-3 overflow-hidden rounded-md border border-border bg-bg-layout",children:(0,r.jsx)("img",{src:Di(e.src,w),alt:l("htmlEditor.inspectorImageSrc",{defaultValue:"Image preview"}),className:"h-28 w-full object-contain"})}),(0,r.jsx)(D,{label:l("htmlEditor.inspectorImageSrc",{defaultValue:"Image source"}),children:(0,r.jsx)("input",{type:"text",className:"w-full h-[30px] rounded-md border border-border bg-foreground/[0.03] px-2 text-[10px] text-foreground outline-none transition-colors focus:border-primary/60",value:e.src||"",onChange:g=>c("src",g.target.value),onBlur:g=>h("src",g.target.value),onKeyDown:b("src"),placeholder:"https://"})})]}),e.isLink&&(0,r.jsxs)("div",{className:"px-4 pb-3",children:[(0,r.jsx)("div",{className:"mb-3 border-t border-foreground/5"}),(0,r.jsx)(D,{label:l("htmlEditor.editorLinkLabel",{defaultValue:"Link URL"}),children:(0,r.jsx)("input",{type:"text",className:"w-full h-[30px] rounded-md border border-border bg-foreground/[0.03] px-2 text-[10px] text-foreground outline-none transition-colors focus:border-primary/60",value:e.href||"",onChange:g=>c("href",g.target.value),onBlur:g=>h("href",g.target.value),onKeyDown:b("href"),placeholder:"https://"})})]}),(0,r.jsxs)(Be,{title:l("htmlEditor.editorColors",{defaultValue:"Colors"}),open:y.colors,onToggle:()=>I("colors"),children:[(0,r.jsx)(D,{label:l("htmlEditor.fieldTextColor",{defaultValue:"Text color"}),children:(0,r.jsx)(Ye,{value:f.color||"",onChange:g=>n("color",g),onPreview:t?g=>t("color",g):void 0})}),(0,r.jsx)(D,{label:l("htmlEditor.inspectorBackground",{defaultValue:"Background"}),children:(0,r.jsx)(Ye,{value:f.backgroundColor||"",onChange:g=>n("backgroundColor",g),onPreview:t?g=>t("backgroundColor",g):void 0})}),s&&(0,r.jsxs)(r.Fragment,{children:[(0,r.jsx)(D,{label:l("htmlEditor.fieldTextColorHover",{defaultValue:"文字颜色 - 悬停"}),children:(0,r.jsx)(Ye,{value:f.hoverColor||"",onChange:g=>s("color",g),onPreview:i?g=>i("color",g):void 0,placeholder:"-"})}),(0,r.jsx)(D,{label:l("htmlEditor.fieldBgColorHover",{defaultValue:"背景色 - 悬停"}),children:(0,r.jsx)(Ye,{value:f.hoverBackgroundColor||"",onChange:g=>s("backgroundColor",g),onPreview:i?g=>i("backgroundColor",g):void 0,placeholder:"-"})})]})]}),(0,r.jsxs)(Be,{title:l("htmlEditor.sectionTypography",{defaultValue:"Typography"}),open:y.typography,onToggle:()=>I("typography"),children:[(0,r.jsx)(D,{label:l("htmlEditor.inspectorFont",{defaultValue:"Font family"}),children:(0,r.jsx)(ke,{value:f.fontFamily||"inherit",onChange:g=>n("fontFamily",g),options:["inherit","-apple-system","Arial","Helvetica","Georgia","Times New Roman","Courier New","monospace"]})}),(0,r.jsxs)(be,{children:[(0,r.jsx)(D,{label:l("htmlEditor.editorFontSize",{defaultValue:"Size"}),children:(0,r.jsx)(Q,{...ne("fontSize",f.fontSize,n,t)})}),(0,r.jsx)(D,{label:l("htmlEditor.editorFontWeight",{defaultValue:"Weight"}),children:(0,r.jsx)(ke,{value:f.fontWeight||"normal",onChange:g=>n("fontWeight",g),options:["100","200","300",{value:"400",label:"400 (Normal)"},{value:"500",label:"500 (Medium)"},{value:"600",label:"600 (Semi Bold)"},{value:"700",label:"700 (Bold)"},"800","900"]})})]}),(0,r.jsx)(D,{label:l("htmlEditor.editorTextAlign",{defaultValue:"Text align"}),children:(0,r.jsx)(Xi,{value:f.textAlign||"start",onChange:g=>n("textAlign",g)})}),(0,r.jsx)(D,{label:l("htmlEditor.fieldTextDecoration",{defaultValue:"Text decoration"}),children:(0,r.jsx)(ke,{value:(f.textDecoration||"none").split(" ")[0],onChange:g=>n("textDecoration",g),options:[{value:"none",label:l("htmlEditor.opt.none",{defaultValue:"None"})},{value:"underline",label:l("htmlEditor.opt.underline",{defaultValue:"Underline"})},{value:"overline",label:l("htmlEditor.opt.overline",{defaultValue:"Overline"})},{value:"line-through",label:l("htmlEditor.opt.lineThrough",{defaultValue:"Line-through"})}]})}),(0,r.jsxs)(be,{children:[(0,r.jsx)(D,{label:l("htmlEditor.fieldLineHeight",{defaultValue:"Line height"}),children:(0,r.jsx)(Q,{...ne("lineHeight",f.lineHeight,n,t)})}),(0,r.jsx)(D,{label:l("htmlEditor.fieldLetterSpacing",{defaultValue:"Letter spacing"}),children:(0,r.jsx)(Q,{...ne("letterSpacing",f.letterSpacing,n,t)})})]})]}),(0,r.jsxs)(Be,{title:l("htmlEditor.editorBorder",{defaultValue:"Border"}),open:y.border,onToggle:()=>I("border"),children:[(0,r.jsx)(D,{label:l("htmlEditor.fieldBorderColor",{defaultValue:"Border color"}),children:(0,r.jsx)(Ye,{value:f.borderColor||"",onChange:g=>n("borderColor",g),onPreview:t?g=>t("borderColor",g):void 0})}),s&&(0,r.jsx)(D,{label:l("htmlEditor.fieldBorderColorHover",{defaultValue:"Border color - hover"}),children:(0,r.jsx)(Ye,{value:f.hoverBorderColor||"",onChange:g=>s("borderColor",g),onPreview:i?g=>i("borderColor",g):void 0,placeholder:"-"})}),(0,r.jsxs)(be,{children:[(0,r.jsx)(D,{label:l("htmlEditor.fieldRadius",{defaultValue:"Radius"}),children:(0,r.jsx)(Q,{...ne("borderRadius",f.borderRadius,n,t)})}),(0,r.jsx)(D,{label:l("htmlEditor.fieldBorderWeight",{defaultValue:"Border weight"}),children:(0,r.jsx)(Q,{...ne("borderWidth",f.borderWidth,n,t)})})]}),(0,r.jsx)(D,{label:l("htmlEditor.editorBorderStyle",{defaultValue:"Border style"}),children:(0,r.jsx)(ke,{value:f.borderStyle||"none",onChange:g=>n("borderStyle",g),options:[{value:"none",label:l("htmlEditor.opt.none",{defaultValue:"None"})},{value:"solid",label:l("htmlEditor.opt.solid",{defaultValue:"Solid"})},{value:"dashed",label:l("htmlEditor.opt.dashed",{defaultValue:"Dashed"})},{value:"dotted",label:l("htmlEditor.opt.dotted",{defaultValue:"Dotted"})},{value:"double",label:l("htmlEditor.opt.double",{defaultValue:"Double"})}]})})]}),(0,r.jsx)(Be,{title:l("htmlEditor.editorDisplay",{defaultValue:"Display"}),open:y.display,onToggle:()=>I("display"),children:(0,r.jsxs)(be,{children:[(0,r.jsx)(D,{label:l("htmlEditor.fieldBehavior",{defaultValue:"Behavior"}),children:(0,r.jsx)(ke,{value:f.display||"block",onChange:g=>n("display",g),options:[{value:"block",label:l("htmlEditor.opt.block",{defaultValue:"Block"})},{value:"inline",label:l("htmlEditor.opt.inline",{defaultValue:"Inline"})},{value:"inline-block",label:l("htmlEditor.opt.inlineBlock",{defaultValue:"Inline-block"})},{value:"flex",label:l("htmlEditor.opt.flex",{defaultValue:"Flex"})},{value:"grid",label:l("htmlEditor.opt.grid",{defaultValue:"Grid"})},{value:"none",label:l("htmlEditor.opt.hidden",{defaultValue:"Hidden"})}]})}),(0,r.jsx)(D,{label:l("htmlEditor.editorOpacity",{defaultValue:"Opacity"}),children:(0,r.jsx)(Q,{value:String(Math.round((1-parseFloat(f.opacity||"1"))*100)),onChange:g=>{const k=Gn(g);k!==null&&n("opacity",k)},onPreview:t?g=>{const k=Gn(g);k!==null&&t("opacity",k)}:void 0,suffix:"%",min:0,max:100,step:1})})]})}),(0,r.jsxs)(Be,{title:l("htmlEditor.editorPadding",{defaultValue:"Padding"}),open:y.padding,onToggle:()=>I("padding"),children:[(0,r.jsxs)(be,{children:[(0,r.jsx)(D,{label:l("htmlEditor.editorTop",{defaultValue:"Top"}),children:(0,r.jsx)(Q,{...ne("paddingTop",f.paddingTop,n,t)})}),(0,r.jsx)(D,{label:l("htmlEditor.editorRight",{defaultValue:"Right"}),children:(0,r.jsx)(Q,{...ne("paddingRight",f.paddingRight,n,t)})})]}),(0,r.jsxs)(be,{children:[(0,r.jsx)(D,{label:l("htmlEditor.editorBottom",{defaultValue:"Bottom"}),children:(0,r.jsx)(Q,{...ne("paddingBottom",f.paddingBottom,n,t)})}),(0,r.jsx)(D,{label:l("htmlEditor.editorLeft",{defaultValue:"Left"}),children:(0,r.jsx)(Q,{...ne("paddingLeft",f.paddingLeft,n,t)})})]})]}),(0,r.jsxs)(Be,{title:l("htmlEditor.editorMargin",{defaultValue:"Margin"}),open:y.margin,onToggle:()=>I("margin"),children:[(0,r.jsxs)(be,{children:[(0,r.jsx)(D,{label:l("htmlEditor.editorTop",{defaultValue:"Top"}),children:(0,r.jsx)(Q,{...ne("marginTop",f.marginTop,n,t)})}),(0,r.jsx)(D,{label:l("htmlEditor.editorRight",{defaultValue:"Right"}),children:(0,r.jsx)(Q,{...ne("marginRight",f.marginRight,n,t)})})]}),(0,r.jsxs)(be,{children:[(0,r.jsx)(D,{label:l("htmlEditor.editorBottom",{defaultValue:"Bottom"}),children:(0,r.jsx)(Q,{...ne("marginBottom",f.marginBottom,n,t)})}),(0,r.jsx)(D,{label:l("htmlEditor.editorLeft",{defaultValue:"Left"}),children:(0,r.jsx)(Q,{...ne("marginLeft",f.marginLeft,n,t)})})]})]}),(0,r.jsx)(Be,{title:l("htmlEditor.editorSize",{defaultValue:"Dimensions"}),open:y.dimensions,onToggle:()=>I("dimensions"),children:(0,r.jsxs)(be,{children:[(0,r.jsx)(D,{label:l("htmlEditor.editorWidth",{defaultValue:"Width"}),children:(0,r.jsx)(Q,{...ne("width",f.width,n,t)})}),(0,r.jsx)(D,{label:l("htmlEditor.editorHeight",{defaultValue:"Height"}),children:(0,r.jsx)(Q,{...ne("height",f.height,n,t)})})]})}),(f.display==="flex"||f.display==="grid")&&(0,r.jsxs)(Be,{title:l("htmlEditor.sectionFlexGrid",{defaultValue:"Flex / Grid"}),open:y.flexgrid,onToggle:()=>I("flexgrid"),children:[(0,r.jsxs)(be,{children:[(0,r.jsx)(D,{label:l("htmlEditor.fieldGap",{defaultValue:"Gap"}),children:(0,r.jsx)(Q,{...ne("gap",f.gap,n,t)})}),(0,r.jsx)(D,{label:l("htmlEditor.fieldDirection",{defaultValue:"Direction"}),children:(0,r.jsx)(ke,{value:f.flexDirection||"row",onChange:g=>n("flexDirection",g),options:[{value:"row",label:l("htmlEditor.opt.row",{defaultValue:"Row"})},{value:"column",label:l("htmlEditor.opt.column",{defaultValue:"Column"})},{value:"row-reverse",label:l("htmlEditor.opt.rowReverse",{defaultValue:"Row reverse"})},{value:"column-reverse",label:l("htmlEditor.opt.columnReverse",{defaultValue:"Column reverse"})}]})})]}),(0,r.jsxs)(be,{children:[(0,r.jsx)(D,{label:l("htmlEditor.fieldJustify",{defaultValue:"Justify"}),children:(0,r.jsx)(ke,{value:f.justifyContent||"normal",onChange:g=>n("justifyContent",g),options:[{value:"normal",label:l("htmlEditor.opt.normal",{defaultValue:"Normal"})},{value:"flex-start",label:l("htmlEditor.opt.flexStart",{defaultValue:"Start"})},{value:"center",label:l("htmlEditor.opt.center",{defaultValue:"Center"})},{value:"flex-end",label:l("htmlEditor.opt.flexEnd",{defaultValue:"End"})},{value:"space-between",label:l("htmlEditor.opt.spaceBetween",{defaultValue:"Space between"})},{value:"space-around",label:l("htmlEditor.opt.spaceAround",{defaultValue:"Space around"})},{value:"space-evenly",label:l("htmlEditor.opt.spaceEvenly",{defaultValue:"Space evenly"})}]})}),(0,r.jsx)(D,{label:l("htmlEditor.fieldAlign",{defaultValue:"Align"}),children:(0,r.jsx)(ke,{value:f.alignItems||"normal",onChange:g=>n("alignItems",g),options:[{value:"normal",label:l("htmlEditor.opt.normal",{defaultValue:"Normal"})},{value:"flex-start",label:l("htmlEditor.opt.flexStart",{defaultValue:"Start"})},{value:"center",label:l("htmlEditor.opt.center",{defaultValue:"Center"})},{value:"flex-end",label:l("htmlEditor.opt.flexEnd",{defaultValue:"End"})},{value:"stretch",label:l("htmlEditor.opt.stretch",{defaultValue:"Stretch"})},{value:"baseline",label:l("htmlEditor.opt.baseline",{defaultValue:"Baseline"})}]})})]})]}),(0,r.jsx)("div",{className:"px-4 pt-4 pb-2",children:(0,r.jsx)("button",{type:"button",onClick:v,className:"w-full h-8 rounded-md border border-destructive/25 text-[12px] font-medium text-destructive hover:bg-destructive/5 transition-colors",children:l("htmlEditor.inspectorDeleteElement",{defaultValue:"删除此组件"})})})]})}function Qi({onSubmit:e,disabled:t,placeholder:n}){const{t:i}=ve("webBuilder"),[s,c]=(0,o.useState)(""),h=(0,o.useRef)(null),v=(0,o.useCallback)(()=>{const u=s.trim();u&&e(u)&&c("")},[s,e]);return(0,r.jsx)("div",{className:"shrink-0 p-3",children:(0,r.jsxs)("div",{className:"relative flex items-start gap-1 rounded-lg border border-border bg-foreground/[0.03] px-2 py-2 transition-colors focus-within:border-primary/50",children:[(0,r.jsx)("svg",{className:"w-3 h-3 shrink-0 mt-0.5",style:{color:Ui},width:"12",height:"12",viewBox:"0 0 24 24",fill:"currentColor","aria-hidden":!0,children:(0,r.jsx)("path",{d:"M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"})}),(0,r.jsx)("textarea",{ref:h,value:s,onChange:u=>c(u.target.value),placeholder:n,rows:3,className:"flex-1 min-w-0 h-[54px] bg-transparent pr-8 text-[12px] font-[inherit] leading-[1.5] text-foreground outline-none resize-none placeholder:text-muted-foreground/50"}),(0,r.jsx)("button",{type:"button",onClick:v,disabled:!s.trim(),title:i("htmlEditor.gate.addedToast",{defaultValue:"已加入待确认"}),className:"absolute right-2 bottom-2 w-[20px] h-[20px] shrink-0 flex items-center justify-center rounded-full bg-primary text-[11px] leading-none text-primary-foreground disabled:opacity-35 disabled:cursor-not-allowed transition-[transform,opacity] hover:opacity-90 active:scale-90",children:"✨"})]})})}function eo({elementData:e,pageStyle:t,onStylePreview:n,onStyleChange:i,onHoverStylePreview:s,onHoverStyleChange:c,onPageStylePreview:h,onPageStyleChange:v,onContentPreview:u,onContentChange:w,onDelete:E,onDeselect:l,pageResetKey:f,editStateRev:y=0,onNaturalLanguageSubmit:_,nlSubmitDisabled:I=!1,onReselectElement:b,showImagePreview:g=!1,imagePreviewBaseUrl:k,onCommitExit:N}){const{t:U}=ve("webBuilder");return(0,r.jsxs)("div",{className:"flex flex-col h-full",children:[_&&(0,r.jsx)(Qi,{onSubmit:_,disabled:I,placeholder:e?U("htmlEditor.aiEditPlaceholder.element",{defaultValue:"Describe how to change this element…"}):U("htmlEditor.aiEditPlaceholder.page",{defaultValue:"Describe how to change the page…"})}),(0,r.jsx)("div",{className:"shrink-0 mx-4 border-b border-foreground/5"}),(0,r.jsx)("div",{className:"flex-1 overflow-y-auto min-h-0",children:e?(0,r.jsx)(r.Fragment,{children:(0,r.jsx)(Ji,{elementData:e,onStylePreview:n,onStyleChange:i,onHoverStylePreview:s,onHoverStyleChange:c,onContentPreview:u||w,onContentChange:w,onDelete:E,showImagePreview:g,imagePreviewBaseUrl:k,onCommitExit:N},`${e.editPath}:${y}`)}):(0,r.jsx)(Zi,{style:t,onStylePreview:h,onStyleChange:v},`${f??""}:${y}`)})]})}function to({pendingVisible:e,historyVisible:t,onClearPendingHighlight:n}){const[i,s]=(0,o.useState)(null),c=(0,o.useCallback)(h=>{i==="pending"&&h!=="pending"&&n(),s(h)},[i,n]);return(0,o.useEffect)(()=>{(i==="pending"&&!e||i==="history"&&!t)&&c(null)},[i,t,e,c]),{expandedOverlay:i,onPendingExpandedChange:(0,o.useCallback)(h=>c(h?"pending":null),[c]),onHistoryExpandedChange:(0,o.useCallback)(h=>c(h?"history":null),[c])}}Oe();st();St();kt();function no({canUndo:e,canRedo:t,onUndo:n,onRedo:i,onClearHighlight:s,leadingActions:c,extraActions:h,showEditControls:v=!0,trackingContext:u=_t,collapsed:w=!1,onExpand:E}){const{t:l}=ve("webBuilder");return!v&&!c&&!h?null:(0,r.jsx)("div",{className:"relative",children:(0,r.jsx)("div",{onMouseLeave:s,children:(0,r.jsx)("div",{role:w?"button":void 0,"aria-label":w?l("webBuilder.toolbar.expand",{defaultValue:"展开工具栏"}):void 0,onClick:w?E:void 0,className:`mx-auto w-fit overflow-hidden rounded-md bg-bg-container border border-border/50 shadow-[0_4px_16px_rgb(0_0_0/0.12)] transition-[height,max-width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${w?"h-4 max-w-16 cursor-pointer hover:bg-foreground/[0.03]":"h-9 max-w-[720px]"}`,children:(0,r.jsxs)("div",{className:`flex h-full shrink-0 items-center gap-1 whitespace-nowrap px-2 transition-opacity duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] ${w?"pointer-events-none opacity-0":"opacity-100 delay-100"}`,children:[c,v&&(0,r.jsxs)("div",{className:"flex shrink-0 items-center gap-1",children:[(0,r.jsx)("div",{className:"mx-1 h-4 w-px shrink-0 bg-border/70"}),(0,r.jsx)(me,{tooltip:l("htmlEditor.editorUndo",{defaultValue:"撤销"}),side:"top",children:(0,r.jsx)("button",{type:"button",onClick:()=>{n(),X.click("accio_site.edit_undo_clk",{...u})},disabled:!e,className:"flex h-6 w-6 items-center justify-center rounded-md text-foreground transition-all duration-150 hover:bg-foreground/[0.06] disabled:pointer-events-none disabled:text-muted-foreground/40",children:(0,r.jsx)(or,{size:14,strokeWidth:1.8,"aria-hidden":!0})})}),(0,r.jsx)(me,{tooltip:l("htmlEditor.editorRedo",{defaultValue:"重做"}),side:"top",children:(0,r.jsx)("button",{type:"button",onClick:()=>{i(),X.click("accio_site.edit_redo_clk",{...u})},disabled:!t,className:"flex h-6 w-6 items-center justify-center rounded-md text-foreground transition-all duration-150 hover:bg-foreground/[0.06] disabled:pointer-events-none disabled:text-muted-foreground/40",children:(0,r.jsx)(ai,{size:14,strokeWidth:1.8,"aria-hidden":!0})})})]}),h]})})})})}zt();var ur={header:"[Canvas Edit] Please modify the source code:",entirePage:"Entire page",elementText:'text "{{text}}"',userInstructions:"User instructions: {{list}}",removeElement:"Remove this element",changeText:'Change text to: "{{value}}"',changeSrc:'Change src to: "{{value}}"',changeHref:'Change href to: "{{value}}"',removeStyle:"Remove {{prop}}",removeHoverStyle:"Remove :hover {{prop}}",verifyFooter:"After applying changes, re-read the modified source file to verify each edit was actually applied correctly. If any change was not applied or applied to the wrong element, fix it before responding."};function ro(e,t){return t?e.replace(/\{\{(\w+)\}\}/g,(n,i)=>String(t[i]??"")):e}var io=(e,t)=>ro(ur[e]??e,t);function oo(){return(e,t)=>Me.t(`webBuilder:htmlEditor.prompt.${e}`,{defaultValue:ur[e]??e,...t})}function ao(e,t){const n=[`<${e.tagName}>`];e.id&&n.push(`id="${e.id}"`),e.className&&n.push(`class="${e.className}"`),e.component&&n.push(`data-component="${e.component}"`),e.componentPath&&e.componentPath.length>1&&n.push(`inside [${e.componentPath.slice(1).join(" > ")}]`);const i=(e.textContent||"").trim();if(i){const s=`${i.slice(0,40)}${i.length>40?"…":""}`;n.push(t("elementText",{text:s}))}return n.join(", ")}function so(e,t=io){const n=[];if(e.kind==="remove-element")n.push(t("removeElement"));else if(e.kind==="set-text")n.push(t("changeText",{value:e.value}));else if(e.kind==="set-src")n.push(t("changeSrc",{value:e.value}));else if(e.kind==="set-href")n.push(t("changeHref",{value:e.value}));else if(e.kind==="set-style")for(const[i,s]of Object.entries(e.styles)){const c=i.replace(/([A-Z])/g,"-$1").toLowerCase();n.push(s?`${c}: ${s}`:t("removeStyle",{prop:c}))}else if(e.kind==="set-hover-style")for(const[i,s]of Object.entries(e.styles)){const c=i.replace(/([A-Z])/g,"-$1").toLowerCase();n.push(s?`:hover ${c}: ${s}`:t("removeHoverStyle",{prop:c}))}return n}function lo(e,t=oo()){if(e.length===0)return"";const n=new Map;let i=0;const s=new WeakMap,c=u=>{if(u&&u.editPath&&u.editPath!=="__page__")return u.editPath;if(!u)return"__page__";if(s.has(u))return s.get(u);const w=`__page__:${i++}`;return s.set(u,w),w};for(const u of e){const w=u.kind==="nl"?u.elementInfo:u.patch.elementInfo,E=c(w);let l=n.get(E);l||(l={info:w,changes:[],instructions:[]},n.set(E,l)),!l.info&&w&&(l.info=w),u.kind==="nl"?l.instructions.push(u.text):l.changes.push(...so(u.patch.patch,t))}const h=[];let v=0;for(const u of n.values()){v++;const w=u.info&&u.info.editPath!=="__page__"?ao(u.info,t):t("entirePage"),E=[`${v}. ${w}`];for(const l of u.changes)E.push(`   - ${l}`);u.instructions.length>0&&E.push(`   - ${t("userInstructions",{list:u.instructions.join(",")})}`),h.push(E.join(`
`))}return`${t("header")}

${h.join(`

`)}

${t("verifyFooter")}`}function co(){return`${Date.now()}-${Math.random().toString(36).slice(2,6)}`}function Kn(e){return e.replace(/([A-Z])/g,"-$1").toLowerCase()}function Ft(e){const t=e.elementInfo.tagName||"element",n=e.patch,i=(n.kind==="set-text"&&e.originalValue.textContent!==void 0?e.originalValue.textContent:e.elementInfo.textContent||"").trim(),s=i?`${t} "${i}"`:t;return n.kind==="set-style"?{component:s,property:Object.keys(n.styles).map(c=>Kn(c)).join(", "),value:Object.values(n.styles).join(", ")}:n.kind==="set-hover-style"?{component:s,property:Object.keys(n.styles).map(c=>`:hover ${Kn(c)}`).join(", "),value:Object.values(n.styles).join(", ")}:n.kind==="set-text"?{component:s,property:"text",value:n.value}:n.kind==="set-src"?{component:s,property:"src",value:n.value}:n.kind==="set-href"?{component:s,property:"href",value:n.value}:n.kind==="remove-element"?{component:s,property:"delete",value:""}:n.kind==="nl-instruction"?{component:s,property:n.text,value:""}:{component:s,property:"",value:""}}function $t(e,t){const{patch:n,originalValue:i,editPath:s}=t;if(n.kind==="set-style"){const c={};for(const h of Object.keys(n.styles))c[h]=i.styles?.[h]||"";e.current?.sendMessage("PREVIEW_STYLE",{editPath:s,styles:c})}else n.kind==="set-hover-style"?e.current?.sendMessage("REVERT_HOVER_STYLE",{editPath:s,properties:Object.keys(n.styles)}):n.kind==="set-text"?e.current?.sendMessage("PREVIEW_CONTENT",{editPath:s,field:"textContent",value:i.textContent??""}):n.kind==="set-src"?e.current?.sendMessage("PREVIEW_CONTENT",{editPath:s,field:"src",value:i.src??""}):n.kind==="set-href"?e.current?.sendMessage("PREVIEW_CONTENT",{editPath:s,field:"href",value:i.href??""}):n.kind==="remove-element"&&e.current?.sendMessage("RESTORE_ELEMENT",{editPath:s})}function Yn(e,t){const{patch:n,editPath:i}=t;n.kind==="set-style"?e.current?.sendMessage("PREVIEW_STYLE",{editPath:i,styles:n.styles}):n.kind==="set-hover-style"?e.current?.sendMessage("PREVIEW_HOVER_STYLE",{editPath:i,styles:n.styles}):n.kind==="set-text"?e.current?.sendMessage("PREVIEW_CONTENT",{editPath:i,field:"textContent",value:n.value}):n.kind==="set-src"?e.current?.sendMessage("PREVIEW_CONTENT",{editPath:i,field:"src",value:n.value}):n.kind==="set-href"?e.current?.sendMessage("PREVIEW_CONTENT",{editPath:i,field:"href",value:n.value}):n.kind==="remove-element"&&e.current?.sendMessage("DELETE_ELEMENT",{editPath:i})}function qn(e){const t=e.patch;return t.kind==="set-style"?`${e.editPath}:style:${Object.keys(t.styles).sort().join(",")}`:t.kind==="set-hover-style"?`${e.editPath}:hover:${Object.keys(t.styles).sort().join(",")}`:t.kind==="set-text"?`${e.editPath}:text`:t.kind==="set-src"?`${e.editPath}:src`:t.kind==="set-href"?`${e.editPath}:href`:t.kind==="remove-element"?`${e.editPath}:remove`:e.id}function uo(e,t){return qn(e)===qn(t)}function ho(e){const{patch:t,originalValue:n}=e;return t.kind==="set-style"?Object.entries(t.styles).every(([i,s])=>(n.styles?.[i]??"")===s):t.kind==="set-text"?(n.textContent??"")===t.value:t.kind==="set-src"?(n.src??"")===t.value:t.kind==="set-href"?(n.href??"")===t.value:!1}function pn(e){const t=e.filter(f=>f.enabled);if(t.length===0)return"";const n=[...t].sort((f,y)=>f.timestamp-y.timestamp),i=n.filter(f=>f.patch.kind==="nl-instruction"),s=n.filter(f=>f.patch.kind!=="nl-instruction"),c={},h={},v={};for(const f of s){const y=f.editPath||f.id;c[y]||(c[y]=f.elementInfo),!h[y]&&f.originalValue.styles&&(h[y]=f.originalValue.styles),v[y]===void 0&&(v[y]=f.timestamp)}const u={};for(const f of n)f.patch.kind==="set-text"&&u[f.editPath]===void 0&&f.originalValue.textContent!==void 0&&(u[f.editPath]=f.originalValue.textContent);const w=f=>{const y=u[f.editPath];return y!==void 0&&y!==f.textContent?{...f,textContent:y}:f},E=Ni(s.map(f=>f.patch.id?f.patch:{...f.patch,id:f.id})),l=[];for(const f of i)l.push({kind:"nl",timestamp:f.timestamp,text:f.patch.text,elementInfo:w(f.elementInfo)});for(const f of E){const y=c[f.id];l.push({kind:"style",timestamp:v[f.id]??0,patch:{patch:f,elementInfo:y?w(y):{editPath:f.id,tagName:"unknown",id:"",className:"",textContent:"",isText:!1,isImage:!1,isLink:!1,src:"",href:"",style:{},inlineStyle:{}},originalStyles:h[f.id]||{}}})}return l.sort((f,y)=>f.timestamp-y.timestamp),lo(l)}var fo=["text","style","href","image","delete"];function po(e){return e===0?"0":e<=20?"1-20":e<=50?"21-50":e<=100?"51-100":"101+"}function go(e){const t=e.filter(v=>v.enabled),n=new Set,i=new Set,s=new Set;let c=0,h=!1;for(const v of t){n.add(v.editPath||"__page__");const u=v.patch;switch(u.kind){case"nl-instruction":h=!0,c+=Array.from(u.text).length;break;case"set-style":case"set-hover-style":i.add("style");for(const w of Object.keys(u.styles))s.add(w);break;case"set-text":i.add("text"),s.add("textContent");break;case"set-src":i.add("image"),s.add("src");break;case"set-href":i.add("href"),s.add("href");break;case"remove-element":i.add("delete");break}}return{change_count:String(t.length),element_count:String(n.size),change_types:fo.filter(v=>i.has(v)).join(","),prop_names:[...s].sort().join(","),prompt_length_bucket:po(c),has_ai_instruction:String(h)}}function mo(e){const[t,n]=(0,o.useState)([]),i=(0,o.useRef)([]),s=(0,o.useCallback)((b,g,k)=>{const N={id:co(),editPath:b.id,elementInfo:g,patch:b,originalValue:k,enabled:!0,timestamp:Date.now()};n(U=>{const R=U.findIndex(de=>uo(de,N));if(R===-1)return[...U,N];const ee=U[R],ie={...N,originalValue:ee.originalValue};return ho(ie)?[...U.slice(0,R),...U.slice(R+1)]:[...U.slice(0,R),...U.slice(R+1),ie]}),i.current=[]},[]),c=(0,o.useCallback)(()=>{n(b=>{if(b.length===0)return b;const g=b[b.length-1];return $t(e,g),i.current=[...i.current,g],b.slice(0,-1)})},[e]),h=(0,o.useCallback)(()=>i.current[i.current.length-1],[]),v=(0,o.useCallback)(()=>{const b=i.current;if(b.length===0)return;const g=b[b.length-1];i.current=b.slice(0,-1),Yn(e,g),n(k=>[...k,g])},[e]),u=(0,o.useCallback)(b=>{n(g=>g.map(k=>{if(k.id!==b)return k;const N={...k,enabled:!k.enabled};return N.enabled?Yn(e,k):$t(e,k),N}))},[e]),w=(0,o.useCallback)(()=>{n(b=>{for(const g of b)g.enabled&&$t(e,g);return[]}),i.current=[]},[e]),E=(0,o.useCallback)(b=>{const g=t.find(k=>k.id===b);g&&(g.enabled&&$t(e,g),n(k=>k.filter(N=>N.id!==b)))},[e,t]),l=(0,o.useCallback)(b=>{b.size!==0&&n(g=>g.filter(k=>!b.has(k.id)))},[]),f=(0,o.useCallback)(()=>t,[t]),y=(0,o.useCallback)(()=>t.filter(b=>b.enabled),[t]),_=(0,o.useCallback)(()=>pn(t),[t]),I=(0,o.useCallback)(()=>go(t),[t]);return{changes:t,addChange:s,undo:c,redo:v,peekRedo:h,canUndo:t.length>0,canRedo:i.current.length>0,toggleChange:u,clearAll:w,discardChange:E,removeChanges:l,getAllChanges:f,getEnabledChanges:y,changeCount:t.length,enabledCount:t.filter(b=>b.enabled).length,hasChanges:t.length>0,generatePrompt:_,generateTrackSummary:I}}Oe();st();St();kt();function vo(e,t){return t?e.length:e.filter(n=>n.enabled).length}function xo({count:e,position:t,onConsumed:n}){const{t:i}=ve("webBuilder");return(0,o.useEffect)(()=>{let s=!1;const c=()=>{s||(s=!0,n())},h=globalThis.setTimeout(c,1200);return()=>{globalThis.clearTimeout(h),c()}},[n,t]),(0,r.jsx)("div",{"data-testid":"staged-edit-hint",className:"pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-full border border-border/50 bg-bg-container px-2 py-1 text-[11px] font-medium text-muted-foreground transition-opacity duration-200",style:{left:t.x,top:t.y},children:i("htmlEditor.gate.pending",{count:e,defaultValue:"{{count}} 项改动待应用"})})}function yo({changes:e,onApply:t,onDiscardAll:n,onClickChange:i,onClearHighlight:s,applyDisabled:c=!1,applying:h=!1,trackingContext:v=_t,gate:u=!1,onDiscardOne:w,onToggleChange:E,expanded:l,onExpandedChange:f}){const{t:y}=ve("webBuilder"),[_,I]=(0,o.useState)(!1),b=l??_,[g,k]=(0,o.useState)(!1);(0,o.useEffect)(()=>{const R=requestAnimationFrame(()=>k(!0));return()=>cancelAnimationFrame(R)},[]);const N=(0,o.useCallback)(()=>{const R=!b;b?(l===void 0&&s(),X.click("accio_site.edit_change_collapse_clk",{...v})):X.click("accio_site.edit_change_expand_clk",{...v}),l===void 0&&I(R),f?.(R)},[l,b,s,f,v]),U=y("htmlEditor.gate.applyCount",{count:vo(e,u),defaultValue:"Apply {{count}} changes"});return(0,r.jsxs)("div",{"data-testid":"canvas-confirm-bar","data-inspector-panel":!0,className:`relative transition-[opacity,transform] duration-200 ease-out ${g?"opacity-100":"opacity-0 translate-y-1"}`,children:[b&&(0,r.jsx)("div",{className:"absolute bottom-full left-1/2 mb-2 w-72 -translate-x-1/2 overflow-hidden rounded-lg border border-border/50 bg-bg-container",children:(0,r.jsxs)("div",{className:"max-h-[40vh] overflow-y-auto overflow-x-hidden",children:[(0,r.jsx)("div",{className:"flex items-center px-3 pb-1.5 pt-2.5",children:(0,r.jsx)("span",{className:"text-[10px] font-semibold tracking-tight text-muted-foreground",children:u?y("htmlEditor.changeHistory.titleGate",{defaultValue:"待应用的改动"}):y("htmlEditor.changeHistory.titleAi",{defaultValue:"需 AI 处理的改动"})})}),(0,r.jsx)("div",{className:"px-1.5 pb-1.5",children:e.map(R=>{const ee=Ft(R);return(0,r.jsxs)("div",{onClick:()=>{X.click("accio_site.edit_change_locate_clk",{...v}),i(R.id)},className:"flex cursor-pointer items-center rounded-md px-2 py-1.5 transition-colors duration-100 hover:bg-foreground/[0.04]",children:[(0,r.jsxs)("div",{className:"flex min-w-0 flex-1 flex-col gap-0.5",children:[(0,r.jsx)("span",{className:"truncate text-[11px] font-medium tracking-tight text-foreground leading-[1.3]",children:ee.component}),(0,r.jsxs)("div",{className:"flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground leading-[1.3]",children:[(0,r.jsx)("span",{className:"shrink-0",children:ee.property}),ee.value&&(0,r.jsx)("span",{className:"truncate font-mono text-[9.5px] text-foreground/70",children:ee.value})]})]}),u?(0,r.jsx)("button",{type:"button",onClick:ie=>{ie.stopPropagation(),X.click("accio_site.edit_discard_one_clk",{...v}),w?.(R.id)},className:"flex shrink-0 cursor-pointer items-center justify-center self-stretch -my-1 -mr-1 ml-1 rounded-r-md px-1 text-muted-foreground/60 transition-colors hover:text-foreground","aria-label":y("htmlEditor.editorDiscardOne",{defaultValue:"丢弃此项"}),children:(0,r.jsx)(ci,{size:12,strokeWidth:2,"aria-hidden":!0})}):(0,r.jsx)("button",{type:"button","data-testid":"canvas-confirm-change-toggle",onClick:ie=>{ie.stopPropagation(),X.click(R.enabled?"accio_site.edit_uncheck_clk":"accio_site.edit_check_clk",{...v}),E?.(R.id)},className:"flex shrink-0 cursor-pointer items-center justify-center self-stretch -my-1 -mr-1 ml-1 rounded-r-md px-1.5","aria-label":R.enabled?y("htmlEditor.changeHistory.uncheck",{defaultValue:"取消选择"}):y("htmlEditor.changeHistory.check",{defaultValue:"选择改动"}),children:(0,r.jsx)("span",{className:`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-all duration-200 ${R.enabled?"border-primary bg-primary":"border-zinc-400 dark:border-white/50"}`,children:(0,r.jsx)(Hn,{size:9,strokeWidth:2.5,"aria-hidden":!0,className:`text-white transition-opacity duration-150 ${R.enabled?"opacity-100":"opacity-0"}`})})})]},R.id)})}),(0,r.jsx)("button",{type:"button","data-testid":"canvas-confirm-discard-all",onClick:()=>{X.click("accio_site.edit_discard_all_clk",{...v}),n()},"aria-label":y("htmlEditor.editorDiscardAll",{defaultValue:"全部丢弃"}),className:"mx-3 mb-2 rounded-md px-2 py-1.5 text-[11px] text-destructive transition-colors duration-150 hover:bg-destructive/8",children:y("htmlEditor.editorDiscardAll",{defaultValue:"全部丢弃"})})]})}),(0,r.jsxs)("div",{className:"flex h-8 items-center gap-1 whitespace-nowrap rounded-full border border-border/50 bg-bg-container px-1",children:[(0,r.jsx)(me,{tooltip:c&&!h?y("htmlEditor.editorApplyStreaming",{defaultValue:"AI 回复中，暂不可提交"}):u?y("htmlEditor.gate.applyTip",{defaultValue:"应用全部改动"}):y("htmlEditor.editorApplyTipAi",{defaultValue:"提交给 AI 处理"}),side:"top",children:(0,r.jsxs)("button",{type:"button","data-testid":"canvas-confirm-apply","aria-disabled":c,"aria-label":U,onClick:R=>{if(c){R.preventDefault();return}t()},className:`flex h-6 shrink-0 items-center gap-1 rounded-full bg-primary px-2.5 text-[11px] font-medium text-primary-foreground transition-all duration-150 ${c?"cursor-not-allowed opacity-40":"hover:bg-primary/90 active:scale-95"}`,children:[h?(0,r.jsx)(ei,{size:11,strokeWidth:2.25,"aria-hidden":!0,className:"animate-spin"}):(0,r.jsx)(Hn,{size:11,strokeWidth:2.5,"aria-hidden":!0}),U]})}),(0,r.jsx)(me,{tooltip:u?y("htmlEditor.changeHistory.titleGate",{defaultValue:"待应用的改动"}):y("htmlEditor.changeHistory.titleAi",{defaultValue:"需 AI 处理的改动"}),side:"top",children:(0,r.jsxs)("button",{type:"button","data-testid":"canvas-confirm-list-toggle",onClick:N,"aria-expanded":b,"aria-label":y("htmlEditor.changeHistory.title",{defaultValue:"查看改动"}),className:`flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] transition-colors hover:bg-foreground/8 hover:text-foreground ${b?"bg-foreground/8 text-foreground":"text-muted-foreground"}`,children:[y("htmlEditor.changeHistory.title",{defaultValue:"查看改动"}),(0,r.jsx)(ii,{size:12,strokeWidth:2.25,"aria-hidden":!0})]})})]})]})}const gn=[{id:"desktop-laptop",label:"Laptop",width:1440,height:900,group:"desktop"},{id:"desktop",label:"Desktop 1080P",width:1920,height:1080,group:"desktop"},{id:"desktop-2k",label:"Desktop 2K",width:2560,height:1440,group:"desktop"},{id:"mobile",label:"iPhone SE",width:375,height:667,group:"phone"},{id:"mobile-max",label:"iPhone 16",width:390,height:844,group:"phone"}];var bo=new Map(gn.map(e=>[e.id,e]));function Wt(e){return bo.get(e)??gn[0]}function Jo(e){return Wt(e).group==="desktop"}st();Oe();lr();St();function Eo(e){return e==="desktop"?ti:e==="tablet"?si:ui}function wo({viewport:e,onChange:t,compact:n,side:i="bottom",fit:s=!1,onFit:c,fitSize:h}){const{t:v}=ve("webBuilder"),u=v("htmlEditor.viewportFit",{defaultValue:"自适应"}),w=(0,o.useMemo)(()=>{const _=[];c&&(_.push({id:"fit",label:u,suffix:h&&h.w>0&&h.h>0?(0,r.jsxs)("span",{className:"text-[10px] text-muted-foreground",children:[h.w,"×",h.h]}):void 0,checked:s,onClick:c}),_.push({id:"sep-fit",type:"separator"}));let I=null;for(const b of gn)I!==null&&I!==b.group&&_.push({id:`sep-${b.group}`,type:"separator"}),I=b.group,_.push({id:b.id,label:b.label,suffix:b.width?(0,r.jsxs)("span",{className:"text-[10px] text-muted-foreground",children:[b.width,"×",b.height]}):void 0,icon:void 0,checked:!s&&e===b.id,onClick:()=>t(b.id)});return _},[e,t,s,c,u,h]),E=Wt(e),l=s?ri:Eo(E.group),f=s?u:E.label,y=(0,r.jsxs)("button",{type:"button",className:"inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium leading-none text-foreground transition hover:bg-foreground/[0.06]",children:[(0,r.jsx)(l,{size:14,strokeWidth:1.8,"aria-hidden":!0}),!n&&(0,r.jsx)("span",{children:f}),(0,r.jsx)(sr,{size:12,strokeWidth:1.8,"aria-hidden":!0,className:"ml-0.5 text-muted-foreground"})]});return(0,r.jsx)(ar,{density:"compact",align:"start",side:i,offset:10,menuWidth:200,items:w,itemClassName:"text-[10px]",hideCheck:!0,trigger:n?(0,r.jsx)(me,{tooltip:f,side:i,children:y}):y})}Oe();st();lr();St();const Co=[.25,.5,.75,1,1.25,1.5,2],Tt=.25;var Xn=e=>`${Math.round(e*100)}%`;function To({zoom:e,onChange:t,side:n="top"}){const i=(0,o.useMemo)(()=>Co.map(u=>({id:String(u),label:Xn(u),checked:Math.abs(e-u)<.001,onClick:()=>t(u)})),[e,t]),{t:s}=ve("webBuilder"),c=u=>Math.min(2,Math.max(Tt,u)),h=u=>t(c(Math.round((e+u)*100)/100)),v=(0,r.jsx)(me,{tooltip:s("htmlEditor.zoom",{defaultValue:"缩放"}),side:n,children:(0,r.jsx)("button",{type:"button",className:"inline-flex h-6 min-w-[44px] items-center justify-center rounded-md px-1 text-[11px] font-medium leading-none tabular-nums text-foreground transition hover:bg-foreground/[0.06]",children:(0,r.jsx)("span",{children:Xn(e)})})});return(0,r.jsxs)("div",{className:"inline-flex h-6 items-center",children:[(0,r.jsx)(me,{tooltip:s("htmlEditor.zoomOut",{defaultValue:"缩小"}),side:n,children:(0,r.jsx)("button",{type:"button",onClick:()=>h(-.05),disabled:e<=Tt,className:"inline-flex h-6 w-6 items-center justify-center rounded-md text-foreground transition hover:bg-foreground/[0.06] disabled:pointer-events-none disabled:text-muted-foreground/40","aria-label":s("htmlEditor.zoomOut",{defaultValue:"缩小"}),children:(0,r.jsx)(hi,{size:14,strokeWidth:1.8,"aria-hidden":!0})})}),(0,r.jsx)(ar,{density:"compact",align:"start",side:n,offset:10,menuWidth:120,items:i,itemClassName:"text-[10px]",hideCheck:!0,trigger:v}),(0,r.jsx)(me,{tooltip:s("htmlEditor.zoomIn",{defaultValue:"放大"}),side:n,children:(0,r.jsx)("button",{type:"button",onClick:()=>h(.05),disabled:e>=2,className:"inline-flex h-6 w-6 items-center justify-center rounded-md text-foreground transition hover:bg-foreground/[0.06] disabled:pointer-events-none disabled:text-muted-foreground/40","aria-label":s("htmlEditor.zoomIn",{defaultValue:"放大"}),children:(0,r.jsx)(oi,{size:14,strokeWidth:1.8,"aria-hidden":!0})})})]})}zt();var So=new Set(["set-style","set-text","set-src","set-href","remove-element"]);function Zn(e,t=""){if(e.length===0)return t||Me.t("webBuilder:htmlEditor.history.editLabel",{defaultValue:"Edit"});const n=Ft(e[0]);return`${t}${n.property?`${n.property}${n.value?` ${n.value}`:""}`:n.component}${e.length>1?Me.t("webBuilder:htmlEditor.history.moreSuffix",{defaultValue:" and {{count}} more",count:e.length}):""}`}function ko({changes:e,removeChanges:t,onApplyLocalPatches:n,onSendAi:i,onFlushed:s,onSentAi:c}){const h=(0,o.useRef)(e);h.current=e;const v=(0,o.useRef)(t);v.current=t;const u=(0,o.useRef)(n);u.current=n;const w=(0,o.useRef)(i);w.current=i;const E=(0,o.useRef)(s);E.current=s;const l=(0,o.useRef)(c);return l.current=c,{applyLocalNow:(0,o.useCallback)(async()=>{const f=u.current,y=h.current.filter(R=>R.enabled),_=f?y.filter(R=>So.has(R.patch.kind)&&R.patch.id):[],I=y.filter(R=>!_.includes(R));let b=[],g=0;if(_.length>0&&f)try{const{failedPatchIds:R,snapshots:ee}=await f(_),ie=new Set(R),de=_.filter(Ee=>!ie.has(Ee.patch.id));b=_.filter(Ee=>ie.has(Ee.patch.id)),g=de.length,de.length>0&&v.current(new Set(de.map(Ee=>Ee.id))),ee&&ee.length>0&&de.length>0&&E.current?.(ee,Zn(de))}catch{return{savedCount:g,degradedCount:b.length,sentAi:!1,error:!0}}const k=[...I,...b];let N=!1;const U=w.current;try{if(k.length>0&&U){const R=pn(k);R&&(U(R),N=!0,l.current?.(Zn(k,Me.t("webBuilder:htmlEditor.history.toAiPrefix",{defaultValue:"Sent to AI: "}))),v.current(new Set(k.map(ee=>ee.id))))}}catch{return{savedCount:g,degradedCount:b.length,sentAi:N,error:!0}}return{savedCount:g,degradedCount:b.length,sentAi:N}},[])}}var _o=new Set(["set-style","set-text","set-src","set-href","remove-element"]);function hr(e){const t=[],n=[];for(const i of e){const s=i.elementInfo.srcLoc,c=i.patch.kind;if(!s||!_o.has(c)){n.push(i);continue}const h={srcLoc:s,changeId:i.id};switch(i.patch.kind){case"set-style":t.push({...h,kind:"set-style",styles:i.patch.styles});break;case"set-text":t.push({...h,kind:"set-text",value:i.patch.value});break;case"set-src":t.push({...h,kind:"set-src",value:i.patch.value});break;case"set-href":t.push({...h,kind:"set-href",value:i.patch.value});break;case"remove-element":t.push({...h,kind:"remove-element"});break;default:n.push(i)}}return{atomic:t,aiFallback:n}}zt();function Ro(e){if(e.length===0)return Me.t("webBuilder:htmlEditor.history.editLabel",{defaultValue:"Edit"});const t=Ft(e[0]);return`${t.property?`${t.property}${t.value?` ${t.value}`:""}`:t.component}${e.length>1?Me.t("webBuilder:htmlEditor.history.moreSuffix",{defaultValue:" and {{count}} more",count:e.length}):""}`}function Io({changes:e,removeChanges:t,onApplyAtomicEdits:n,onFlushed:i}){const s=(0,o.useRef)(e);s.current=e;const c=(0,o.useRef)(t);c.current=t;const h=(0,o.useRef)(n);h.current=n;const v=(0,o.useRef)(i);return v.current=i,{flushAtomicNow:(0,o.useCallback)(async()=>{const u=h.current;if(!u)return{degraded:[],savedCount:0};const{atomic:w}=hr(s.current.filter(E=>E.enabled));if(w.length===0)return{degraded:[],savedCount:0};try{const{failedChangeIds:E,snapshots:l}=await u(w),f=new Set(E),y=new Set(w.filter(_=>!f.has(_.changeId)).map(_=>_.changeId));if(y.size>0&&c.current(y),l&&l.length>0){const _=s.current.filter(I=>y.has(I.id));v.current?.(l,Ro(_))}return{degraded:[...f],savedCount:y.size}}catch{return{degraded:[],savedCount:0,error:!0}}},[])}}function Jn(){return`${Date.now()}-${Math.random().toString(36).slice(2,6)}`}function Po({writeFiles:e}){const[t,n]=(0,o.useState)([]),[i,s]=(0,o.useState)(!1),c=(0,o.useCallback)((u,w)=>{u.length!==0&&n(E=>{let l=E.length;for(;l>0;){const f=E[l-1];if(f.kind==="ast"&&f.status==="undone"&&!f.settled)l--;else break}return[...E.slice(0,l),{id:Jn(),kind:"ast",label:w,files:u,status:"applied",settled:!1,timestamp:Date.now()}]})},[]),h=(0,o.useCallback)(u=>{n(w=>[...w,{id:Jn(),kind:"ai",label:u,settled:!1,timestamp:Date.now()}]),s(!0)},[]),v=(0,o.useRef)(!1);return{entries:t,sealed:i,pushAst:c,pushAi:h,undo:(0,o.useCallback)(async()=>{if(!e||i||v.current)return!1;let u=null;for(let E=t.length-1;E>=0;E--){const l=t[E];if(l.kind==="ast"&&l.status==="applied"&&!l.settled){u=l;break}}if(!u)return!1;const w=u.id;v.current=!0,n(E=>E.map(l=>l.id===w&&l.kind==="ast"?{...l,status:"undone"}:l));try{return await e(u.files.map(E=>({relPath:E.relPath,content:E.before}))),!0}catch{return n(E=>E.map(l=>l.id===w&&l.kind==="ast"?{...l,status:"applied"}:l)),!1}finally{v.current=!1}},[e,i,t]),redo:(0,o.useCallback)(async()=>{if(!e||i||v.current)return!1;let u=null;for(const E of t)if(E.kind==="ast"&&E.status==="undone"&&!E.settled){u=E;break}if(!u)return!1;const w=u.id;v.current=!0,n(E=>E.map(l=>l.id===w&&l.kind==="ast"?{...l,status:"applied"}:l));try{return await e(u.files.map(E=>({relPath:E.relPath,content:E.after}))),!0}catch{return n(E=>E.map(l=>l.id===w&&l.kind==="ast"?{...l,status:"undone"}:l)),!1}finally{v.current=!1}},[e,i,t]),settle:(0,o.useCallback)(()=>{n(u=>u.length===0?u:u.map(w=>w.settled?w:{...w,settled:!0})),s(!1)},[]),clear:(0,o.useCallback)(()=>{n([]),s(!1)},[]),canUndo:(0,o.useMemo)(()=>!i&&t.some(u=>u.kind==="ast"&&u.status==="applied"&&!u.settled),[t,i]),canRedo:(0,o.useMemo)(()=>!i&&t.some(u=>u.kind==="ast"&&u.status==="undone"&&!u.settled),[t,i]),hasEntries:t.length>0}}zt();function Lo(e){const t=Me.t("webBuilder:htmlEditor.history.sentToAi",{defaultValue:"Sent to AI"});if(e.length===0)return t;const n=Ft(e[0]);return`${t}: ${n.property?`${n.property}${n.value?` ${n.value}`:""}`:n.component}${e.length>1?Me.t("webBuilder:htmlEditor.history.moreSuffix",{defaultValue:" and {{count}} more",count:e.length}):""}`}function Ao({changes:e,removeChanges:t,onSend:n,onSent:i}){const s=(0,o.useRef)(e);s.current=e;const c=(0,o.useRef)(t);c.current=t;const h=(0,o.useRef)(n);h.current=n;const v=(0,o.useRef)(i);return v.current=i,{sendAiNow:(0,o.useCallback)(u=>{const w=h.current;if(!w)return!1;const E=s.current.filter(I=>I.enabled),{aiFallback:l}=hr(E),f=u.size>0?E.filter(I=>u.has(I.id)&&!l.some(b=>b.id===I.id)):[],y=[...l,...f];if(y.length===0)return!1;const _=pn(y);return _?(w(_),v.current?.(Lo(y)),c.current(new Set(y.map(I=>I.id))),!0):!1},[])}}Oe();st();kt();function jo({entries:e,sealed:t,trackingContext:n=_t,expanded:i,onExpandedChange:s}){const{t:c}=ve("webBuilder"),[h,v]=(0,o.useState)(!1),u=i??h,w=(0,o.useCallback)(()=>{const E=!u;X.click(u?"accio_site.edit_history_collapse_clk":"accio_site.edit_history_expand_clk",{...n}),i===void 0&&v(E),s?.(E)},[i,u,s,n]);return(0,r.jsxs)("div",{className:"relative w-fit",children:[u&&(0,r.jsx)("div",{className:"absolute bottom-full left-0 mb-[4px] w-72 overflow-hidden rounded-lg bg-bg-container border border-border/50 shadow-[0_8px_32px_rgb(0_0_0/0.12)]",children:(0,r.jsxs)("div",{className:"max-h-[50vh] overflow-y-auto overflow-x-hidden",children:[(0,r.jsxs)("div",{className:"flex items-center justify-between px-3 pb-1.5 pt-2.5",children:[(0,r.jsx)("span",{className:"text-[10px] font-semibold tracking-tight text-muted-foreground",children:c("htmlEditor.editHistory.title",{defaultValue:"编辑历史"})}),(0,r.jsx)("span",{className:"text-[9px] font-medium tabular-nums text-muted-foreground/70",children:c("htmlEditor.editHistory.count",{defaultValue:"{{count}} 条",count:e.length})})]}),t&&(0,r.jsx)("div",{className:"mx-3 mb-1.5 rounded-md bg-status-warning-bg px-2 py-1.5 text-[10px] leading-[1.4] text-status-warning-text",children:c("htmlEditor.editHistory.sealed",{defaultValue:"已交给 AI 处理，之前的改动不能再撤销"})}),(0,r.jsx)("div",{className:"px-1.5 pb-1.5",children:e.map(E=>{const l=E.kind==="ai",f=E.kind==="ast"&&E.status==="undone",y=E.settled,_=y?"text-muted-foreground/50":l?"text-primary":"text-muted-foreground";let I;return y?I="text-muted-foreground/50":f?I="text-muted-foreground/60 line-through":l?I="text-primary font-medium":I="text-foreground",(0,r.jsxs)("div",{className:"flex items-center gap-2 rounded-md px-2 py-1.5",children:[(0,r.jsx)("span",{className:`flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] ${_}`,children:l?(0,r.jsx)(li,{size:11,strokeWidth:1.8,"aria-hidden":!0}):(0,r.jsx)(or,{size:11,strokeWidth:1.8,"aria-hidden":!0})}),(0,r.jsx)("span",{className:`min-w-0 flex-1 truncate text-[11px] tracking-tight leading-[1.3] ${I}`,children:E.label}),y?(0,r.jsx)("span",{className:"shrink-0 text-[9px] text-muted-foreground/50",children:c("htmlEditor.editHistory.settled",{defaultValue:"已完成"})}):f?(0,r.jsx)("span",{className:"shrink-0 text-[9px] text-muted-foreground/60",children:c("htmlEditor.editHistory.undone",{defaultValue:"已撤销"})}):null]},E.id)})})]})}),(0,r.jsx)("div",{className:"overflow-hidden rounded-md bg-bg-container border border-border/50 shadow-[0_4px_16px_rgb(0_0_0/0.12)]",children:(0,r.jsx)("div",{className:"flex h-[34px] shrink-0 items-center whitespace-nowrap pl-2.5 pr-2",children:(0,r.jsxs)("button",{type:"button",onClick:w,className:"flex h-5 shrink-0 cursor-pointer items-center gap-1.5 select-none rounded px-1 transition hover:bg-foreground/6",children:[(0,r.jsx)("span",{className:"whitespace-nowrap text-[10px] font-medium tracking-tight tabular-nums text-foreground",children:c("htmlEditor.editHistory.pill",{defaultValue:"{{count}} 条改动",count:e.length})}),(0,r.jsx)(sr,{size:12,strokeWidth:1.8,"aria-hidden":!0,className:`shrink-0 text-muted-foreground transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${u?"":"rotate-180"}`})]})})})]})}async function No(e,t,n=performance.now.bind(performance)){const i=n(),s={savedCount:0,degradedCount:0,sentAi:!1,errorType:"none"};try{return await e(s),s}catch(c){throw s.errorType="unexpected_error",c}finally{t(s,n()-i)}}function Do({savedCount:e,degradedCount:t,sentAi:n,errorType:i,durationMs:s}){const c=e>0&&n?"mixed":e>0?"saved":n?"sent_ai":"failed";return{submit_flow:"gate",result:c,saved_count:e,degraded_count:t,sent_ai:n,error_type:c==="failed"&&i==="none"?"no_effect":i,duration_ms:Number.isFinite(s)?Math.max(0,Math.round(s)):0}}Oe();St();st();kt();var sn=24,Qn=48,at=8,Bo=104;function Mo({elementRect:e,offsetX:t,offsetY:n,zoom:i,containerWidth:s,containerHeight:c}){const h=t+(e.left+e.right)/2*i,v=Math.max(at+Qn,Math.min(h,s-at-Qn));let u=n+e.top*i-at;return u<sn+at&&(u=n+e.bottom*i+sn+at),u=Math.max(sn+at,Math.min(u,c-Bo)),{x:v,y:u}}function Oo(e,t,n){return t===0?{nextCount:0,position:null}:e===0&&n?{nextCount:t,position:n}:{nextCount:e,position:null}}function er(e,t,n){const i={[t]:n},s=e.style.backgroundImage&&e.style.backgroundImage!=="none";t==="backgroundColor"&&s&&(i.backgroundImage="none");const c=e.style.display==="flex"||e.style.display==="inline-flex";return t==="textAlign"&&c&&(i.justifyContent={start:"flex-start",left:"flex-start",center:"center",right:"flex-end",justify:"space-between"}[n]||n),i}function Ho(e,t,n){return{...e,[t]:n}}function tr(e,t){return Object.entries(t).every(([n,i])=>(e[n]??"")===i)}function nr(e,t,n){const i=e.get(t);return i===void 0?!1:(e.delete(t),i===n)}function ln(e){return"hover"+e.charAt(0).toUpperCase()+e.slice(1)}function rr(e){if(e.button!==0)return;const t=document.querySelectorAll("iframe");t.forEach(i=>{i.style.pointerEvents="none"});const n=()=>{t.forEach(i=>{i.style.pointerEvents=""}),window.removeEventListener("pointerup",n),window.removeEventListener("pointercancel",n)};window.addEventListener("pointerup",n),window.addEventListener("pointercancel",n)}function Qo({src:e,html:t,viewport:n="desktop",viewportWidth:i,viewportHeight:s,editing:c,onApplied:h,onApplyAtomicEdits:v,onApplyLocalPatches:u,onWriteFiles:w,editHistoryExternal:E,trackingContext:l=_t,onDirtyChange:f,streaming:y=!1,changesResetKey:_,toolbarExtra:I,deviceViewport:b,onDeviceChange:g,initialFit:k=!0,onFitChange:N,onRefresh:U,refreshing:R=!1,refreshLabel:ee,routeInput:ie,errorOverlay:de,showImagePreview:Ee=!1,onPreviewLinkClick:lt}){const{t:K}=ve(["webBuilder","chat"]),dt=ee??K("files.refresh",{defaultValue:"Refresh"}),$=(0,o.useRef)(null),[ct,Rt]=(0,o.useState)(!1),[qe,Xe]=(0,o.useState)(!1);(0,o.useEffect)(()=>{if(y){Xe(!1);return}if(!ct){Xe(!1);return}const a=window.setTimeout(()=>Xe(!0),800);return()=>window.clearTimeout(a)},[y,ct]);const[x,oe]=(0,o.useState)(null),It=(0,o.useRef)(null);It.current=x;const[ce,Ze]=(0,o.useState)({}),ut=(0,o.useRef)(null),_e=(0,o.useRef)(null),[Pt,ht]=(0,o.useState)(!1),[He,Lt]=(0,o.useState)(!1),[Ve,At]=(0,o.useState)(null),[Ut,Gt]=(0,o.useState)(!0),[$e,Je]=(0,o.useState)(!0),[Qe,we]=(0,o.useState)(null),[ue,he]=(0,o.useState)(1),[xe,Re]=(0,o.useState)(k),Ie=(0,o.useCallback)(a=>{Re(a),N?.(a)},[N]),[Ce,Kt]=(0,o.useState)(null),[et,Te]=(0,o.useState)(null),ft=(0,o.useRef)(""),[tt,pt]=(0,o.useState)(0),[Pe,jt]=(0,o.useState)(0),Le=(0,o.useRef)(null),[ye,gt]=(0,o.useState)(!1),[We,m]=(0,o.useState)({x:0,y:0}),M=(0,o.useRef)(!1),O=(0,o.useRef)({x:0,y:0,ox:0,oy:0}),j=(0,o.useRef)(null),ae=(0,o.useRef)(!1),G=(0,o.useRef)({x:0,y:0}),A=(0,o.useRef)(1),Z=Ve?Ve==="floating":Pt;(0,o.useEffect)(()=>{const a=ut.current;if(!a)return;let d=!0;const p=new ResizeObserver(T=>{ht((T[0]?.contentRect.width??0)<1108),d&&(d=!1,requestAnimationFrame(()=>Lt(!0)))});return p.observe(a),()=>p.disconnect()},[]),(0,o.useEffect)(()=>{const a=j.current;if(!a)return;const d=new ResizeObserver(()=>{pt(a.clientHeight),jt(a.clientWidth)});return d.observe(a),pt(a.clientHeight),jt(a.clientWidth),()=>d.disconnect()},[]);const Y=(0,o.useRef)(!1);(0,o.useEffect)(()=>{if(!Y.current){Y.current=!0;return}Te(null),gt(!1),m({x:0,y:0}),Ie(!1)},[b,n]),(0,o.useEffect)(()=>{gt(!1),m({x:0,y:0})},[c]),(0,o.useEffect)(()=>{const a=j.current;if(!a)return;const d=S=>{const J=-S*.005;Te(q=>{const it=Math.min(2,Math.max(Tt,parseFloat(((q??ue)+J).toFixed(2))));return he(it),it})},p=S=>{Te(J=>{const le=Math.min(2,Math.max(Tt,parseFloat(((J??ue)*S).toFixed(2))));return he(le),le})},T=S=>{S.ctrlKey&&(S.preventDefault(),d(S.deltaY))};let B=0;const V=S=>{if(S.touches.length!==2)return;const J=S.touches[0].clientX-S.touches[1].clientX,q=S.touches[0].clientY-S.touches[1].clientY;B=Math.sqrt(J*J+q*q)},L=S=>{if(S.touches.length!==2||B===0)return;S.preventDefault();const J=S.touches[0].clientX-S.touches[1].clientX,q=S.touches[0].clientY-S.touches[1].clientY,le=Math.sqrt(J*J+q*q);p(le/B),B=le},P=()=>{B=0};a.addEventListener("wheel",T,{passive:!1}),a.addEventListener("touchstart",V,{passive:!0}),a.addEventListener("touchmove",L,{passive:!1}),a.addEventListener("touchend",P,{passive:!0});const z=S=>{const J=$.current?.getIframe()?.contentWindow;!J||S.source!==J||(S.data?.type==="CANVAS_WHEEL_ZOOM"&&d(S.data.data?.deltaY??0),S.data?.type==="CANVAS_PINCH_ZOOM"&&p(S.data.data?.ratio??1))};return window.addEventListener("message",z),()=>{a.removeEventListener("wheel",T),a.removeEventListener("touchstart",V),a.removeEventListener("touchmove",L),a.removeEventListener("touchend",P),window.removeEventListener("message",z)}},[ue]),(0,o.useEffect)(()=>{if(xe)return;const a=Pe,d=tt;if(!a||!d)return;const p=b?Wt(b):null,T=p?.width??i??null,B=p?.height??s??null;if(!T||!B)return;const V=8,L=60,P=a-V*2,z=d-V-L;if(P<=0||z<=0)return;let S=Math.min(P/T,z/B);S=Math.min(1,Math.max(Tt,parseFloat(S.toFixed(2)))),Kt(S),ft.current!==`${b}`?(ft.current=`${b}`,Te(null),he(S)):et||he(S)},[c,b,n,tt,Pe,xe]);const F=208,re=400,H=8,Ae=(0,o.useCallback)(a=>{const d=_e.current,p=d?.querySelector("iframe");if(!d||!p)return null;const T=d.clientWidth,B=d.clientHeight,V=d.getBoundingClientRect(),L=p.getBoundingClientRect(),P=L.left-V.left,z=L.top-V.top,S=A.current||1,J=P+a.left*S,q=P+a.right*S,le=z+a.top*S,it=z+a.bottom*S,Kr=T-q,Yr=J;let ot,De;const qr=Kr>=F+H,Xr=Yr>=F+H;return qr?(ot=q+H,De=it+H):Xr?(ot=J-F-H,De=it+H):(ot=T-F-H,De=it+H),De+re>B-H&&(De=le-re-H),ot=Math.max(H,Math.min(ot,T-F-H)),De=Math.max(H,Math.min(De,B-re-H)),{x:ot,y:De}},[]),mt=(0,o.useCallback)(a=>{const d=_e.current,p=d?.querySelector("iframe");if(!d||!p)return null;const T=d.getBoundingClientRect(),B=p.getBoundingClientRect();return Mo({elementRect:a,offsetX:B.left-T.left,offsetY:B.top-T.top,zoom:A.current||1,containerWidth:d.clientWidth,containerHeight:d.clientHeight})},[]);(0,o.useEffect)(()=>{const a=_e.current;if(!a)return;const d=new ResizeObserver(p=>{const{width:T,height:B}=p[0]?.contentRect??{width:0,height:0};we(V=>V&&{x:Math.max(H,Math.min(V.x,T-F-H)),y:Math.max(H,Math.min(V.y,B-re-H))})});return d.observe(a),()=>d.disconnect()},[]);const C=mo($),[mn,fr]=(0,o.useState)(!1),W=(0,o.useCallback)(()=>{fr(rt.current!==null||Object.keys(je.current).length>0||Object.keys(Fe.current).length>0||Object.keys(Ne.current).length>0)},[]),[pr,vn]=(0,o.useState)(0),nt=(0,o.useCallback)(()=>{je.current={},Fe.current={},Ne.current={},rt.current=null,ze.current={},fe.current={},W(),Ze({}),oe(null),vn(a=>a+1)},[W]),xn=(0,o.useRef)(_);(0,o.useEffect)(()=>{xn.current!==_&&(xn.current=_,C.clearAll(),nt())},[_,C,nt]);const fe=(0,o.useRef)({}),ze=(0,o.useRef)({}),rt=(0,o.useRef)(null),Yt=(0,o.useRef)(null),je=(0,o.useRef)({}),qt=(0,o.useRef)(null),Fe=(0,o.useRef)({}),Xt=(0,o.useRef)(null),Ne=(0,o.useRef)({}),Zt=(0,o.useRef)(null),vt=(0,o.useRef)(new Map),xt=(0,o.useRef)(new Map),yn=(0,o.useCallback)(()=>{const a=It.current?.editPath;a&&$.current?.sendMessage("RESELECT_ELEMENT",{editPath:a,echo:!0})},[]),pe=(0,o.useCallback)((a,d)=>{vt.current.clear(),xt.current.clear(),fe.current={},vn(L=>L+1),ze.current={};const p=L=>{if(L.patch.kind!=="set-hover-style")return{};const P={};for(const[z,S]of Object.entries(L.patch.styles))P[ln(z)]=d==="forward"?S:"";return P},T=L=>{if(L.patch.kind!=="set-style")return{};const P={};for(const[z,S]of Object.entries(L.patch.styles))P[z]=d==="forward"?S:L.originalValue.styles?.[z]??"";return P},B=L=>{const{patch:P,originalValue:z}=L;return P.kind==="set-text"?{textContent:d==="forward"?P.value:z.textContent??""}:P.kind==="set-src"?{src:d==="forward"?P.value:z.src??""}:P.kind==="set-href"?{href:d==="forward"?P.value:z.href??""}:{}},V={};for(const L of a)L.editPath==="__page__"&&Object.assign(V,T(L));Object.keys(V).length>0&&Ze(L=>({...L,...V})),oe(L=>{if(!L)return L;const P={},z={},S={};for(const q of a)q.editPath===L.editPath&&(Object.assign(P,T(q)),Object.assign(z,B(q)),Object.assign(S,p(q)));if(Object.keys(P).length===0){const q=Object.keys(z).length>0,le=Object.keys(S).length>0;return!q&&!le?L:{...L,...z,style:le?{...L.style,...S}:L.style}}const J={};for(const[q,le]of Object.entries(P))le!==""&&(J[q]=le);return{...L,...z,style:{...L.style,...J,...S},inlineStyle:{...L.inlineStyle,...P}}}),yn()},[yn]);(0,o.useEffect)(()=>{f?.(C.hasChanges||mn)},[C.hasChanges,mn,f]);const gr=Po({writeFiles:w}),te=E??gr,{toasts:mr,show:Ue,dismiss:vr}=bi(1800),bn=(0,o.useCallback)((a,d)=>{te.pushAst(a,d)},[te]),{flushAtomicNow:En}=Io({changes:C.changes,removeChanges:C.removeChanges,onApplyAtomicEdits:v,onFlushed:bn}),{sendAiNow:wn}=Ao({changes:C.changes,removeChanges:C.removeChanges,onSend:v?h:void 0,onSent:te.pushAi}),{applyLocalNow:Cn}=ko({changes:C.changes,removeChanges:C.removeChanges,onApplyLocalPatches:u,onSendAi:h,onFlushed:bn,onSentAi:te.pushAi}),Se=!!(v||u),[Tn,Sn]=(0,o.useState)(!1),Jt=(0,o.useRef)(!1),xr=(0,o.useCallback)(async()=>{if(!(y||Jt.current)){Jt.current=!0,Sn(!0);try{await No(async a=>{const d=C.generateTrackSummary();if(X.click("accio_site.edit_submit_clk",{...l,...d,submit_flow:"gate"}),v){const p=await En();a.savedCount=p.savedCount,a.degradedCount=p.degraded.length,p.error?a.errorType="atomic_apply_failed":a.sentAi=wn(new Set(p.degraded))}else{const p=await Cn();a.savedCount=p.savedCount,a.degradedCount=p.degradedCount,a.sentAi=p.sentAi,p.error&&(a.errorType="local_apply_failed")}a.errorType!=="none"?Ue(K("htmlEditor.gate.applyFailedToast",{defaultValue:"保存失败，改动仍在队列，可重试"}),"error",{dedupKey:"canvas-apply-fail"}):a.sentAi?Ue(K("htmlEditor.editHistory.toAiToast",{defaultValue:"已交给 AI 处理"}),"warning",{dedupKey:"canvas-apply-ai"}):a.savedCount>0&&Ue(K("htmlEditor.editHistory.savedToast",{defaultValue:"改动已保存"}),"success",{dedupKey:"canvas-apply-saved"})},(a,d)=>{X.custom("accio_site.edit_submit_result",{...l,...Do({...a,durationMs:d})})})}catch{Ue(K("htmlEditor.gate.applyFailedToast",{defaultValue:"保存失败，改动仍在队列，可重试"}),"error",{dedupKey:"canvas-apply-fail"})}finally{Jt.current=!1,Sn(!1)}}},[y,C,l,v,En,wn,Cn,Ue,K]),kn=(0,o.useRef)(y);(0,o.useEffect)(()=>{kn.current&&!y&&te.settle(),kn.current=y},[y,te]);const Qt=(0,o.useCallback)(()=>{const a=C.changes[C.changes.length-1];C.undo(),a&&pe([a],"back")},[C,pe]),en=(0,o.useCallback)(()=>{const a=C.peekRedo();C.redo(),a&&pe([a],"forward")},[C,pe]),se=(0,o.useRef)(!1),Nt=(0,o.useCallback)(async a=>{if(!se.current){se.current=!0;try{await a()&&nt()}finally{se.current=!1}}},[nt]),yr=(0,o.useCallback)(()=>{C.canUndo?Qt():Nt(()=>te.undo())},[C,te,Qt,Nt]),br=(0,o.useCallback)(()=>{te.canRedo?Nt(()=>te.redo()):en()},[te,en,Nt]),Er=C.canUndo||te.canUndo,wr=C.canRedo||te.canRedo,Cr=(0,o.useCallback)(()=>{const a=C.changes.filter(d=>d.enabled);C.clearAll(),pe(a,"back")},[C,pe]),Tr=(0,o.useCallback)(a=>{const d=C.changes.find(p=>p.id===a);C.discardChange(a),d?.enabled&&pe([d],"back")},[C,pe]),Sr=(0,o.useCallback)(a=>{const d=C.changes.find(p=>p.id===a);C.toggleChange(a),d&&pe([d],d.enabled?"back":"forward")},[C,pe]),[_n,Rn]=(0,o.useState)(null),kr=(0,o.useCallback)(()=>Rn(null),[]),In=(0,o.useRef)(0),tn=(C.changes.length>0?C.changes.reduce((a,d)=>a.timestamp>=d.timestamp?a:d):null)?.elementInfo.rect??null;(0,o.useEffect)(()=>{const a=C.changes.length,d=tn?mt(tn):null,p=Oo(In.current,a,d);In.current=p.nextCount,(a===0||p.position)&&Rn(p.position)},[C.changes.length,tn,mt]);const Pn=(0,o.useRef)(Z);Pn.current=Z;const Ln=(0,o.useRef)(l);Ln.current=l,(0,o.useEffect)(()=>{c&&X.exposure("accio_site.editor_exp",{...Ln.current,mode:Pn.current?"float":"sidebar"})},[c,e,l.identity_scene==="html_editor"?l.document_id:void 0]);const An=(0,o.useRef)(c);An.current=c,(0,o.useEffect)(()=>{$.current?.sendMessage("SET_MODE",{mode:c?"edit":"preview"});const a=d=>{const p=$.current?.getIframe()?.contentWindow;!p||d.source!==p||d.data?.type==="ACCIO_EDITOR_READY"&&$.current?.sendMessage("SET_MODE",{mode:An.current?"edit":"preview"})};return window.addEventListener("message",a),()=>window.removeEventListener("message",a)},[c]);const jn=(0,o.useCallback)(a=>{if(!se.current){if(!a.rect){oe(d=>{if(!d||d.editPath!==a.editPath)return d;const p={...d.style,...a.style};for(const T of["hoverColor","hoverBackgroundColor","hoverBorderColor"])d.style[T]===""&&(p[T]="");return{...d,...a,rect:d.rect,style:p,inlineStyle:{...d.inlineStyle,...a.inlineStyle}}});return}if(Yt.current?.(),qt.current?.(),Zt.current?.(),Xt.current?.(),vt.current.clear(),xt.current.clear(),a.editPath&&(ze.current[a.editPath]={textContent:a.textContent,src:a.src,href:a.href},delete fe.current[a.editPath]),oe(a),Gt(!0),a.rect&&Z){const d=Ae(a.rect);d&&we(d)}else Z||we(null)}},[Z,Ae]),_r=(0,o.useCallback)(a=>{if(!ye||a.button!==0)return;a.preventDefault();const d=j.current;d&&(M.current=!0,d.dataset.panning="1",O.current={x:a.clientX,y:a.clientY,ox:We.x,oy:We.y},d.setPointerCapture(a.pointerId))},[ye,We]),Rr=(0,o.useCallback)(a=>{if(!M.current)return;const d=a.clientX-O.current.x,p=a.clientY-O.current.y;m({x:O.current.ox+d,y:O.current.oy+p})},[]),Ir=(0,o.useCallback)(a=>{M.current=!1,j.current&&delete j.current.dataset.panning},[]),Pr=(0,o.useCallback)(a=>{const d=a.currentTarget.closest("[data-floating-panel]");if(!d)return;ae.current=!0;const p=_e.current;if(!p)return;const T=d.getBoundingClientRect();p.getBoundingClientRect(),G.current={x:a.clientX-T.left,y:a.clientY-T.top};const B=L=>{if(!ae.current)return;const P=_e.current?.getBoundingClientRect();if(!P)return;const z=L.clientX-P.left-G.current.x,S=L.clientY-P.top-G.current.y;we({x:Math.max(H,Math.min(z,P.width-F-H)),y:Math.max(H,Math.min(S,P.height-re-H))})},V=()=>{ae.current=!1,document.removeEventListener("pointermove",B),document.removeEventListener("pointerup",V)};document.addEventListener("pointermove",B),document.addEventListener("pointerup",V)},[]),yt=(0,o.useCallback)(()=>{Yt.current?.(),qt.current?.(),Zt.current?.(),Xt.current?.()},[]),Ge=(0,o.useCallback)(()=>{yt(),oe(null),$.current?.sendMessage("DESELECT_ELEMENT")},[yt]),Dt=(0,o.useCallback)((a,d,p,T=!1)=>{if(se.current)return;const B=a.editPath,V=er(a,d,p);$.current?.sendMessage("PREVIEW_STYLE",{editPath:B,styles:V});const L=fe.current[B]||{...a.inlineStyle};if(T||delete fe.current[B],oe(P=>P&&P.editPath===B?{...P,style:{...P.style,...V},inlineStyle:{...P.inlineStyle,...V}}:P),!tr(L,V)){for(const[P,z]of Object.entries(V))C.addChange({id:B,kind:"set-style",styles:{[P]:z}},a,{styles:L});X.custom("accio_site.edit_prop_staged",{...l,element_id:B,prop_name:d})}},[C,l]),Lr=(0,o.useCallback)((a,d)=>{if(x){for(const p of Object.keys(je.current))je.current[p]?.property===a&&delete je.current[p];W(),!nr(vt.current,a,d)&&Dt(x,a,d)}},[x,Dt,W]),Ar=(0,o.useCallback)((a,d)=>{if(!x||se.current)return;const p=x.editPath;fe.current[p]||(fe.current[p]={...x.inlineStyle});const T=er(x,a,d);$.current?.sendMessage("PREVIEW_STYLE",{editPath:p,styles:T}),je.current[`${p}:${a}`]={element:x,property:a,value:d},W(),vt.current.delete(a),oe(B=>B&&{...B,style:Ho(B.style,a,d)})},[x,W]);qt.current=(0,o.useCallback)(()=>{const a=Object.values(je.current);if(a.length===0)return;je.current={},W();const d=new Map;a.forEach((p,T)=>d.set(p.element.editPath,T)),a.forEach((p,T)=>{Dt(p.element,p.property,p.value,d.get(p.element.editPath)!==T),vt.current.set(p.property,p.value)})},[Dt,W]);const Nn=(0,o.useMemo)(()=>({editPath:"__page__",tagName:"body",id:"",className:"",textContent:"",isText:!1,isImage:!1,isLink:!1,src:"",href:"",style:ce,inlineStyle:ce}),[ce]),jr=(0,o.useCallback)((a,d)=>{se.current||(fe.current.__page__||(fe.current.__page__={...ce}),$.current?.sendMessage("PREVIEW_STYLE",{editPath:"__page__",styles:{[a]:d}}),Fe.current[a]=d,W(),Ze(p=>({...p,[a]:d})))},[ce,W]),Bt=(0,o.useCallback)((a,d)=>{if(se.current)return;$.current?.sendMessage("PREVIEW_STYLE",{editPath:"__page__",styles:{[a]:d}});const p=fe.current.__page__||{...ce};tr(p,{[a]:d})||(C.addChange({id:"__page__",kind:"set-style",styles:{[a]:d}},Nn,{styles:p}),X.custom("accio_site.edit_prop_staged",{...l,element_id:"__page__",prop_name:a})),Ze(T=>({...T,[a]:d}))},[ce,Nn,C,l]),Nr=(0,o.useCallback)((a,d)=>{delete Fe.current[a],W(),Bt(a,d),Object.keys(Fe.current).length===0&&delete fe.current.__page__},[Bt,W]);Xt.current=(0,o.useCallback)(()=>{const a=Object.entries(Fe.current);if(a.length!==0){Fe.current={},W();for(const[d,p]of a)Bt(d,p);delete fe.current.__page__}},[Bt,W]);const Mt=(0,o.useCallback)((a,d,p)=>{if(se.current)return;const T=a.editPath;$.current?.sendMessage("PREVIEW_HOVER_STYLE",{editPath:T,styles:{[d]:p}}),C.addChange({id:T,kind:"set-hover-style",styles:{[d]:p}},a,{styles:{...a.inlineStyle}}),X.custom("accio_site.edit_prop_staged",{...l,element_id:T,prop_name:d})},[C,l]),Dr=(0,o.useCallback)((a,d)=>{if(x){for(const p of Object.keys(Ne.current))Ne.current[p]?.property===a&&delete Ne.current[p];W(),!nr(xt.current,a,d)&&(Mt(x,a,d),oe(p=>p&&{...p,style:{...p.style,[ln(a)]:d}}))}},[x,Mt,W]),Br=(0,o.useCallback)((a,d)=>{x&&(se.current||($.current?.sendMessage("PREVIEW_HOVER_STYLE",{editPath:x.editPath,styles:{[a]:d}}),Ne.current[`${x.editPath}:${a}`]={element:x,property:a,value:d},W(),xt.current.delete(a),oe(p=>p&&{...p,style:{...p.style,[ln(a)]:d}})))},[x,W]);Zt.current=(0,o.useCallback)(()=>{const a=Object.values(Ne.current);if(a.length!==0){Ne.current={},W();for(const d of a)Mt(d.element,d.property,d.value),xt.current.set(d.property,d.value)}},[Mt,W]);const Mr=(0,o.useCallback)((a,d)=>{if(!x||se.current)return;const p=x.editPath;ze.current[p]||(ze.current[p]={textContent:x.textContent,src:x.src,href:x.href}),$.current?.sendMessage("PREVIEW_CONTENT",{editPath:p,field:a,value:d}),rt.current={element:x,field:a,value:d},W(),oe(T=>T&&{...T,[a]:d})},[x,W]),Ot=(0,o.useCallback)((a,d,p)=>{if(se.current)return;const T=a.editPath;$.current?.sendMessage("PREVIEW_CONTENT",{editPath:T,field:d,value:p});const B=ze.current[T]||{textContent:a.textContent,src:a.src,href:a.href};if(delete ze.current[T],B[d]===p)return;const V=d==="textContent"?{id:T,kind:"set-text",value:p}:d==="src"?{id:T,kind:"set-src",value:p}:{id:T,kind:"set-href",value:p};C.addChange(V,a,B),X.custom("accio_site.edit_prop_staged",{...l,element_id:T,prop_name:d})},[C,l]);Yt.current=(0,o.useCallback)(()=>{const a=rt.current;a&&(rt.current=null,W(),Ot(a.element,a.field,a.value))},[Ot,W]);const Or=(0,o.useCallback)((a,d)=>{x&&(rt.current=null,W(),Ot(x,a,d),oe(p=>p&&{...p,[a]:d}))},[x,Ot,W]);(0,o.useEffect)(()=>{if(!c||!x)return;const a=d=>{d.target?.closest("[data-inspector-panel]")||Ge()};return document.addEventListener("pointerdown",a,!0),()=>{document.removeEventListener("pointerdown",a,!0)}},[c,x,Ge]);const Hr=(0,o.useCallback)(()=>{x&&(se.current||(yt(),$.current?.sendMessage("DELETE_ELEMENT",{editPath:x.editPath}),C.addChange({id:x.editPath,kind:"remove-element"},x,{styles:{...x.style}}),oe(null)))},[x,C,yt]),Vr=(0,o.useCallback)(a=>{if(se.current)return!1;X.click("accio_site.edit_freetext_stage_clk",{...l});const d=x||{editPath:"__page__",tagName:"page",id:"",className:"",textContent:"",isText:!1,isImage:!1,isLink:!1,src:"",href:"",style:{},inlineStyle:{}};return C.addChange({id:d.editPath,kind:"nl-instruction",text:a},d,{}),(v||u)&&Ue(K("htmlEditor.gate.addedToast",{defaultValue:"已加入待确认"}),"success",{dedupKey:"canvas-gate-added"}),!0},[x,C,l,v,u,Ue,K]),$r=(0,o.useCallback)(()=>{const a=C.generateTrackSummary();X.click("accio_site.edit_submit_clk",{...l,...a,submit_flow:"legacy"});const d=C.generatePrompt();d&&h?.(d);const p=C.changes.filter(T=>T.enabled);C.clearAll(),pe(p,"back")},[C,h,l,pe]),Wr=(0,o.useCallback)(a=>{const d=C.changes.find(p=>p.id===a);d&&($.current?.sendMessage("SCROLL_AND_HIGHLIGHT",{editPath:d.editPath}),$.current?.sendMessage("RESELECT_ELEMENT",{editPath:d.editPath}))},[C.changes]),nn=(0,o.useCallback)(()=>{$.current?.sendMessage("CLEAR_HIGHLIGHT")},[]),Ht=to({pendingVisible:c&&C.changes.length>0,historyVisible:c&&Se&&te.hasEntries,onClearPendingHighlight:nn}),zr=(0,o.useCallback)(()=>{x&&$.current?.sendMessage("RESELECT_ELEMENT",{editPath:x.editPath})},[x]),Vt=b?Wt(b):null,Fr=Vt?Vt.width:i??null,Ur=Vt?Vt.height:s??null;let rn;const ge={},Dn=8,Gr=60,Bn=Math.max(0,Math.round(Pe-Dn*2)),Mn=Math.max(0,Math.round(tt-Dn-Gr)),bt=xe?Bn:Fr,Et=xe?Mn:Ur,on=!!(bt&&Et),wt=on?et??ue:1;if(A.current=wt,bt&&Et?(rn="shrink-0",ge.width=bt,ge.height=Et):rn="flex-1 self-stretch",wt!==1&&bt&&Et){ge.transform=`scale(${wt})`,ge.transformOrigin="center center";const a=Et*(1-wt)/2,d=bt*(1-wt)/2;ge.marginTop=-a,ge.marginBottom=-a,ge.marginLeft=-d,ge.marginRight=-d}const On=(0,r.jsx)(eo,{elementData:x,pageResetKey:_,editStateRev:pr,pageStyle:ce,onStylePreview:Ar,onStyleChange:Lr,onHoverStylePreview:Br,onHoverStyleChange:Dr,onPageStylePreview:jr,onPageStyleChange:Nr,onContentPreview:Mr,onContentChange:Or,onDelete:Hr,onDeselect:Ge,onCommitExit:Ge,onNaturalLanguageSubmit:h?Vr:void 0,nlSubmitDisabled:y,onReselectElement:zr,showImagePreview:Ee,imagePreviewBaseUrl:e});return(0,r.jsxs)("div",{ref:ut,className:"relative flex min-h-0 flex-1 overflow-hidden",children:[(0,r.jsxs)("div",{ref:_e,className:"relative flex flex-1 flex-col overflow-hidden",children:[(0,r.jsx)("div",{ref:j,className:`relative flex flex-1 justify-center items-center bg-zinc-50 dark:bg-zinc-950 px-2 pt-2 pb-[60px] ${ye?"overflow-hidden cursor-grab [&[data-panning]]:cursor-grabbing":on?"overflow-auto":"overflow-hidden"}`,style:c?{backgroundImage:"radial-gradient(circle, rgb(0 0 0 / 0.04) 1px, transparent 1px)",backgroundSize:"8px 8px"}:void 0,onPointerDown:_r,onPointerMove:Rr,onPointerUp:Ir,onPointerCancel:a=>{M.current=!1,j.current&&delete j.current.dataset.panning},onClick:a=>{ye||a.target===a.currentTarget&&x&&Ge()},children:(0,r.jsxs)("div",{ref:Le,className:`relative ${rn} overflow-hidden border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900`,style:(()=>{if(!on)return ge;const a=`translate(${We.x}px, ${We.y}px)`;return{...ge,transform:`${a}${ge.transform?` ${ge.transform}`:""}`}})(),children:[e?(0,r.jsx)(zn,{ref:$,src:e,trackingContext:l,editable:!0,editing:c,externalPanel:!0,sandbox:!1,deviceType:n==="desktop"?"desktop":"mobile",onElementSelected:c?jn:void 0,onElementDeselected:c?Ge:void 0,onRenderErrorChange:de?Rt:void 0,onLoad:nt,onPreviewLinkClick:lt}):t?(0,r.jsx)(zn,{ref:$,html:t,trackingContext:l,editable:!0,editing:c,externalPanel:!0,sandbox:!1,deviceType:n==="desktop"?"desktop":"mobile",onElementSelected:c?jn:void 0,onElementDeselected:c?Ge:void 0,onLoad:nt,onPreviewLinkClick:lt}):null,qe&&de,ye&&(0,r.jsx)("div",{className:"absolute inset-0 z-50"})]})}),c&&_n&&(0,r.jsx)(xo,{count:C.changes.length,position:_n,onConsumed:kr}),(0,r.jsx)("div",{"data-inspector-panel":!0,className:"absolute bottom-4 left-1/2 z-10 -translate-x-1/2",onPointerDown:a=>{yt(),rr(a)},children:(0,r.jsxs)("div",{className:"flex items-end gap-2",children:[c&&C.changes.length>0&&(0,r.jsx)(yo,{gate:Se,trackingContext:l,changes:C.changes,onApply:Se?xr:$r,onDiscardAll:Cr,onDiscardOne:Tr,onToggleChange:Sr,onClickChange:Wr,onClearHighlight:nn,applyDisabled:Se?y||Tn:y,applying:Tn,expanded:Ht.expandedOverlay==="pending",onExpandedChange:Ht.onPendingExpandedChange}),c&&Se&&te.hasEntries&&(0,r.jsx)(jo,{trackingContext:l,entries:te.entries,sealed:te.sealed,expanded:Ht.expandedOverlay==="history",onExpandedChange:Ht.onHistoryExpandedChange}),(0,r.jsx)(no,{trackingContext:l,canUndo:Se?Er:C.canUndo,canRedo:Se?wr:C.canRedo,onUndo:Se?yr:Qt,onRedo:Se?br:en,onClearHighlight:nn,showEditControls:c,leadingActions:(0,r.jsxs)(r.Fragment,{children:[b&&g&&(0,r.jsx)(wo,{viewport:b,onChange:a=>{Ie(!1),g(a)},fit:xe,onFit:()=>{Ie(!0),Te(null),he(1),m({x:0,y:0})},fitSize:{w:Bn,h:Mn},side:"top",compact:!0}),b&&g&&(0,r.jsx)("div",{className:"mx-1 h-4 w-px shrink-0 bg-border/70"}),(0,r.jsx)(To,{zoom:et??ue,onChange:a=>{he(a),Te(a)},side:"top"}),(ie||U)&&(0,r.jsx)("div",{className:"mx-1 h-4 w-px shrink-0 bg-border/70"}),ie,(0,r.jsx)(me,{tooltip:ye?K("htmlEditor.exitPanMode",{defaultValue:"退出拖拽"}):K("htmlEditor.panMode",{defaultValue:"拖拽画布"}),side:"top",children:(0,r.jsx)("button",{type:"button",onClick:()=>gt(a=>!a),className:`inline-flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-foreground/6 ${ye?"bg-foreground/8 text-foreground":"text-foreground"}`,"aria-label":ye?K("htmlEditor.exitPanMode",{defaultValue:"退出拖拽"}):K("htmlEditor.panMode",{defaultValue:"拖拽画布"}),"aria-pressed":ye,children:(0,r.jsx)(ni,{size:14,strokeWidth:1.8,"aria-hidden":!0})})}),U&&(0,r.jsx)(me,{tooltip:dt,side:"top",children:(0,r.jsx)("button",{type:"button",onClick:U,disabled:R,className:"inline-flex h-6 w-6 items-center justify-center rounded-md text-foreground transition hover:bg-foreground/[0.06] disabled:pointer-events-none disabled:text-muted-foreground/40","aria-label":dt,children:(0,r.jsx)(di,{size:14,strokeWidth:1.8,"aria-hidden":!0,className:R?"animate-spin":void 0})})})]}),extraActions:I})]})}),c&&(0,r.jsxs)("div",{"data-floating-panel":!0,"data-inspector-panel":!0,onPointerDown:rr,className:`absolute z-20 flex w-[208px] max-h-[400px] flex-col overflow-hidden rounded-xl border border-border/70 bg-bg-container shadow-[0_8px_32px_rgb(0_0_0/0.10)] transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${Z&&Ut?"opacity-100 scale-100":"pointer-events-none opacity-0 scale-95"}`,style:Qe?{left:Qe.x,top:Qe.y}:{top:12,right:12},children:[(0,r.jsxs)("div",{className:"flex shrink-0 items-center gap-0.5 px-2.5 py-2.5 cursor-grab active:cursor-grabbing select-none",onPointerDown:Pr,children:[(0,r.jsx)("span",{className:"flex-1 text-[11px] font-medium text-foreground",children:K("htmlEditor.panelTitle",{defaultValue:"编辑"})}),(0,r.jsx)(me,{tooltip:K("htmlEditor.dockPanel",{defaultValue:"固定到右侧"}),side:"bottom",children:(0,r.jsx)("button",{type:"button",className:"flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/6 transition-colors",onClick:()=>{At("docked"),X.click("accio_site.editor_switch_clk",{...l,mode:"sidebar"})},children:(0,r.jsxs)("svg",{width:"12",height:"12",viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round",children:[(0,r.jsx)("rect",{x:"1",y:"2",width:"14",height:"12",rx:"2"}),(0,r.jsx)("line",{x1:"10",y1:"2",x2:"10",y2:"14"})]})})})]}),(0,r.jsx)("div",{className:"shrink-0 border-b border-foreground/5"}),(0,r.jsx)("div",{className:"min-h-0 overflow-y-auto",children:On})]})]}),(0,r.jsxs)("div",{"data-inspector-panel":!0,className:`flex shrink-0 flex-col border-l border-border/60 bg-bg-container overflow-hidden ${He?"transition-[width,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]":""} ${c&&!Z&&He?"w-[208px] opacity-100":"w-0 opacity-0"}`,children:[(0,r.jsxs)("div",{className:"flex w-[208px] shrink-0 items-center gap-0.5 px-2.5 py-2.5",children:[(0,r.jsx)("span",{className:"flex-1 text-[11px] font-medium text-foreground",children:K("htmlEditor.panelTitle",{defaultValue:"编辑"})}),(0,r.jsx)(me,{tooltip:K("htmlEditor.floatPanel",{defaultValue:"切换为悬浮"}),side:"bottom",children:(0,r.jsx)("button",{type:"button",className:"flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/6 transition-colors",onClick:()=>{if(x?.rect){const a=Ae(x.rect);a&&we(a)}At("floating"),X.click("accio_site.editor_switch_clk",{...l,mode:"float"})},children:(0,r.jsxs)("svg",{width:"12",height:"12",viewBox:"0 0 16 16",fill:"none",stroke:"currentColor",strokeWidth:"1.5",strokeLinecap:"round",strokeLinejoin:"round",children:[(0,r.jsx)("rect",{x:"4",y:"3",width:"10",height:"10",rx:"2"}),(0,r.jsx)("path",{d:"M4 7H2.5A1.5 1.5 0 011 5.5v-3A1.5 1.5 0 012.5 1h3A1.5 1.5 0 017 2.5V3"})]})})})]}),(0,r.jsx)("div",{className:"shrink-0 border-b border-border/50"}),(0,r.jsx)("div",{className:"overflow-y-auto min-h-0 flex-1",children:On})]}),(0,r.jsx)(Ei,{toasts:mr,position:"top",onDismiss:vr})]})}export{Wt as a,gn as i,Po as n,Jo as o,wo as r,Zo as s,Qo as t};
