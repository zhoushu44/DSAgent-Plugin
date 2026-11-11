/**
 * pdd-missing-apis.mjs —— 补齐 jsdom 缺失的浏览器 API
 *
 * 背景（2026-11-09 追踪实证）：
 *   同一份 promo-sdk.mjs：
 *     - 真实浏览器 → 读 win.requestAnimationFrame（主路径）
 *     - jsdom      → 读 win.MediaSource（兜底路径）
 *   说明 jsdom 里**某个操作抛了异常**，SDK catch 后走了降级分支，
 *   降级分支产出的指纹/时间精度与主路径不同 → 服务端判定参数异常（mikasaErrorCode:12）。
 *
 *   MediaSource 在 SDK 源码里是**未被混淆的字面量**（全文件仅 1 处），
 *   是可靠的分支标志：**jsdom 不该读到 MediaSource**。
 *
 * 本模块把 jsdom 缺的浏览器 API 补上，让 SDK 走主路径。
 */

/** 在 jsdom window 上补齐 API，返回补了哪些 */
export function fillMissingApis(w) {
  const added = []
  const has = (k) => {
    try { return w[k] !== undefined && w[k] !== null } catch { return false }
  }
  const set = (k, v) => {
    try { w[k] = v; added.push(k) } catch (e) { }
  }

  /* ── AudioContext（音频指纹，jsdom 完全没有）── */
  if (!has('AudioContext')) {
    const mkAudioCtx = () => {
      const node = () => ({
        connect() { return this }, disconnect() { }, start() { }, stop() { },
        frequency: { value: 440, setValueAtTime() { }, linearRampToValueAtTime() { } },
        gain: { value: 1, setValueAtTime() { } }, type: 'sine',
        threshold: { value: -24, k: 20, ratio: 12, attack: 0.003, release: 0.25 },
        reduction: 0, oversample: '2x',
      })
      const ctx = {
        currentTime: 0, sampleRate: 44100, state: 'running', destination: node(),
        createOscillator: node, createGain: node, createDynamicsCompressor: node,
        createAnalyser: () => ({ getByteFrequencyData: (a) => a.fill(0), getFloatFrequencyData: (a) => a.fill(0), frequencyBinCount: 1024 }),
        createScriptProcessor: () => node, createBufferSource: node,
        createBuffer: (ch, len, sr) => ({ numberOfChannels: ch, length: len, sampleRate: sr,
          getChannelData: () => new Float32Array(len) }),
        resume: async () => { }, suspend: async () => { }, close: async () => { },
        startRendering: async () => ({ numberOfChannels: 1, length: 44100, sampleRate: 44100,
          getChannelData: () => new Float32Array(44100) }),
        addEventListener() { }, removeEventListener() { },
      }
      return ctx
    }
    set('AudioContext', function AudioContext() { return mkAudioCtx() })
    set('webkitAudioContext', function webkitAudioContext() { return mkAudioCtx() })
  }
  if (!has('OfflineAudioContext')) {
    const mkOffline = () => {
      const node = () => ({
        connect() { return this }, disconnect() { }, start() { }, stop() { },
        frequency: { value: 440, setValueAtTime() { }, linearRampToValueAtTime() { } },
        gain: { value: 1, setValueAtTime() { } }, type: 'sine',
        threshold: { value: -24, k: 20, ratio: 12, attack: 0.003, release: 0.25 },
        reduction: 0, oversample: '2x',
      })
      return {
        currentTime: 0, sampleRate: 44100, state: 'suspended', destination: node(),
        createOscillator: node, createGain: node, createDynamicsCompressor: node,
        createAnalyser: () => ({ getByteFrequencyData: (a) => a.fill(0), frequencyBinCount: 1024 }),
        createBufferSource: node,
        createBuffer: (ch, len, sr) => ({ numberOfChannels: ch, length: len, sampleRate: sr,
          getChannelData: () => new Float32Array(len) }),
        startRendering: async () => ({ numberOfChannels: 1, length: 44100, sampleRate: 44100,
          getChannelData: () => new Float32Array(44100) }),
        addEventListener() { }, removeEventListener() { },
      }
    }
    set('OfflineAudioContext', function OfflineAudioContext() { return mkOffline() })
    set('webkitOfflineAudioContext', function webkitOfflineAudioContext() { return mkOffline() })
  }

  /* ── WebGL / canvas 扩展 ── */
  if (!has('WebGLRenderingContext')) set('WebGLRenderingContext', function () { })
  if (!has('WebGL2RenderingContext')) set('WebGL2RenderingContext', function () { })

  /* ── 权限 / 媒体 / 连接 ── */
  if (!has('Notification')) {
    const N = function Notification() { }
    N.permission = 'default'
    N.requestPermission = async () => 'default'
    set('Notification', N)
  }
  try {
    if (!w.navigator || !w.navigator.permissions) {
      Object.defineProperty(w.navigator, 'permissions', {
        get: () => ({ query: async () => ({ state: 'prompt', name: 'notifications' }),
          request: async () => ({ state: 'prompt' }) }),
        configurable: true,
      })
      added.push('navigator.permissions')
    }
  } catch (e) { }
  try {
    if (!w.navigator || !w.navigator.mediaDevices) {
      Object.defineProperty(w.navigator, 'mediaDevices', {
        get: () => ({
          enumerateDevices: async () => ([
            { deviceId: 'default', kind: 'audioinput', label: '', groupId: 'g1' },
            { deviceId: 'default', kind: 'videoinput', label: '', groupId: 'g1' },
            { deviceId: 'default', kind: 'audiooutput', label: '', groupId: 'g1' },
          ]),
          getUserMedia: async () => ({ getTracks: () => [], getSettings: () => ({}), close() { } }),
          getSupportedConstraints: () => ({ width: true, height: true, frameRate: true }),
        }),
        configurable: true,
      })
      added.push('navigator.mediaDevices')
    }
  } catch (e) { }
  try {
    if (!w.navigator || !w.navigator.connection) {
      Object.defineProperty(w.navigator, 'connection', {
        get: () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false, type: 'wifi' }),
        configurable: true,
      })
      added.push('navigator.connection')
    }
  } catch (e) { }
  try {
    if (!w.navigator || !w.navigator.storage) {
      Object.defineProperty(w.navigator, 'storage', {
        get: () => ({ estimate: async () => ({ quota: 299977221120, usage: 0, usageDetails: {} }) }),
        configurable: true,
      })
      added.push('navigator.storage')
    }
  } catch (e) { }

  /* ── Web Crypto subtle ── */
  try {
    if (!w.crypto || !w.crypto.subtle) {
      const subtle = {
        digest: async (alg, data) => new Uint8Array(32),
        encrypt: async () => new ArrayBuffer(16),
        decrypt: async () => new ArrayBuffer(16),
        sign: async () => new ArrayBuffer(16),
        verify: async () => true,
        generateKey: async () => ({}),
        exportKey: async () => new ArrayBuffer(16),
        importKey: async () => ({}),
        deriveBits: async () => new ArrayBuffer(16),
      }
      if (!w.crypto) set('crypto', { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a }, subtle, randomUUID: () => '00000000-0000-4000-8000-000000000000' })
      else Object.defineProperty(w.crypto, 'subtle', { get: () => subtle, configurable: true })
      added.push('crypto.subtle')
    }
  } catch (e) { }

  /* ── 观察者 / 任务 / 视口 ── */
  if (!has('PerformanceObserver')) {
    set('PerformanceObserver', function PerformanceObserver(cb) { this.observe = () => { }; this.disconnect = () => { }; this.takeRecords = () => [] })
  }
  if (!has('ResizeObserver')) {
    set('ResizeObserver', function ResizeObserver() { this.observe = () => { }; this.unobserve = () => { }; this.disconnect = () => { } })
  }
  if (!has('IntersectionObserver')) {
    set('IntersectionObserver', function IntersectionObserver() { this.observe = () => { }; this.unobserve = () => { }; this.disconnect = () => { }; this.takeRecords = () => [] })
  }
  if (!has('MutationObserver')) {
    set('MutationObserver', function MutationObserver() { this.observe = () => { }; this.disconnect = () => { }; this.takeRecords = () => [] })
  }
  if (!has('Worker')) set('Worker', function Worker() { this.postMessage = () => { }; this.terminate = () => { }; this.onmessage = null; this.addEventListener = () => { }; this.removeEventListener = () => { } })
  if (!has('SharedWorker')) set('SharedWorker', function SharedWorker() { this.port = { postMessage: () => { }, start: () => { }, close: () => { }, addEventListener: () => { } } })
  if (!has('RTCPeerConnection')) set('RTCPeerConnection', function RTCPeerConnection() { this.createDataChannel = () => ({}); this.createOffer = async () => ({}); this.createAnswer = async () => ({}); this.setLocalDescription = async () => { }; this.setRemoteDescription = async () => { }; this.addEventListener = () => { }; this.close = () => { } })
  if (!has('speechSynthesis')) set('speechSynthesis', { speak() { }, cancel() { }, pause() { }, resume() { }, getVoices: () => [], addEventListener() { }, removeEventListener() { } })
  if (!has('matchMedia')) {
    set('matchMedia', (q) => ({
      media: q, matches: false, onchange: null,
      addListener() { }, removeListener() { }, addEventListener() { }, removeEventListener() { }, dispatchEvent: () => false,
    }))
  }
  if (!has('visualViewport')) {
    set('visualViewport', { width: 1920, height: 1080, scale: 1, offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0,
      addEventListener() { }, removeEventListener() { } })
  }
  if (!has('customElements')) set('customElements', { define() { }, get() { return undefined }, whenDefined: async () => { } })
  if (!has('history')) set('history', { length: 1, state: null, scrollRestoration: 'auto', pushState() { }, replaceState() { }, back() { }, forward() { }, go() { } })
  if (!has('indexedDB')) set('indexedDB', { open: () => ({ onupgradeneeded: null, onsuccess: null, onerror: null }) })
  if (!has('caches')) set('caches', { open: async () => ({ match: async () => undefined, put: async () => { }, delete: async () => { } }), keys: async () => [], has: async () => false, delete: async () => false })
  if (!has('WebAssembly')) set('WebAssembly', { instantiate: async () => ({}), compile: async () => ({}), validate: () => true, Module: function () { }, Instance: function () { } })

  /* ── document.fonts / fonts.ready ── */
  try {
    if (!w.document.fonts) {
      Object.defineProperty(w.document, 'fonts', {
        get: () => ({ check: () => true, load: async () => [], ready: Promise.resolve(), addEventListener() { }, removeEventListener() { } }),
        configurable: true,
      })
      added.push('document.fonts')
    }
  } catch (e) { }

  /* ── window.getComputedStyle / getSelection 之类已由 jsdom 提供，跳过 ── */

  return added
}

export default fillMissingApis
