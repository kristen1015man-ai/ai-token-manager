/**
 * 加密模块 — 从 shared 重新导出
 * 保持向后兼容，所有 web 端的现有导入无需修改
 */
export {
  isEncrypted,
  encrypt,
  decrypt,
  ensureEncrypted,
  ensureDecrypted,
  safeEqual,
} from "../../../shared/crypto.js";
