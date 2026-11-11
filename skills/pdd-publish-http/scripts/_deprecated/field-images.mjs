/**
 * 发布组件 · 图片上传（主图 / 详情图 / 计数读取）
 *
 * ★ 设计原则：只 re-export lib 里已验证的函数，不改逻辑。
 *   lib 里的 uploadImages 已经实现了：
 *     · 主图逐张上传 + CDP setFileInputFiles 兜底
 *     · 短 ASCII 路径（中文长路径会让 uploadFile 静默失败，由 publish.mjs 预先复制）
 *   lib 里的 uploadDetailImages 已经实现了：
 *     · 详情图逐张 + 计数验证 + 30s 超时 + 3 次重试
 */
export {
  uploadImages,       // 通用图片上传（主图/详情图都可用）
  uploadDetailImages, // 详情图专用（带计数验证）
  readUploadCount,    // 读「已上传 N/M 张」计数
  findFileInput,      // 兜底：找页面首个可用 file input
} from '../../../lib/pdd-publish.js'
