// 统一角色 / 权限判断 helper.
//
// 历史: 19 个 .jsx 文件各自写了
//   const isSuperAdmin = user?.role === 'SUPER_ADMIN'                     // 严格 (13 处)
//   const isSuperAdmin = user?.role === 'SUPER_ADMIN'
//                       || user?.role?.toLowerCase() === 'admin'         // 宽松 (6 处)
//                       || user?.role?.toLowerCase() === 'superadmin'
// 导致 Documents.jsx (宽松) 与 CrmCustomerManagement.jsx (严格) 行为不一致:
//   若某用户 role 字面是 'admin', Documents 会看到公司下拉, CRM 页面看不到.
//
// 本文件统一为"宽松"模式, 保留历史上 6 处宽松位置接受的角色集合, 避免破坏现有 super admin 登录路径.
// 若未来需要收紧, 在此处一处改即可.
//
// 2026-08-27: 进一步兼容 PostgreSQL 场景: 数据库里 INSERT 时 role 列可能是
//   'SUPER_ADMIN' / 'ADMIN' / 'admin' / 'super_admin' / 中文 '超级管理员',
//   加上 localStorage 中历史残留缓存的各种旧值, 所以别名必须覆盖所有变体.
//   判定策略: 大小写不敏感 + 去下划线 + 去连字符 后比对 3 个规范化词:
//   superadmin / superadministrator / administrator.

const SUPER_ADMIN_ALIASES = [
  // 后端 enum 规范值
  'SUPER_ADMIN',
  // 历史别名(permissions.js v1): 已被 6 处前端使用
  'admin', 'superadmin',
  // 下划线 / 连字符变体 (前端误写、URL参数、环境变量)
  'super-admin', 'super_admin', 'SUPERADMIN', 'SUPER-ADMIN',
  // 后端 UserRole.ADMIN 误存 (旧版注册接口直接 user.setRole("ADMIN"))
  'ADMIN',
  // 完全全称
  'SUPER_ADMINISTRATOR', 'super-administrator', 'super_administrator', 'superadministrator', 'administrator', 'ADMINISTRATOR',
  // 中文显示值 (前端渲染后错误回流到 localStorage)
  '超级管理员', '超管',
  // 公司 admin 用户名兜底: 如果 role 恰好和用户名一样 ("admin") 也当作 super admin
  // —— 这一条能保证 init.sql 里默认 'admin' 账号无论 role 列怎么写都始终命中
]

const COMPANY_ADMIN_ALIASES = [
  'COMPANY_ADMIN', 'company_admin', 'company-admin', 'COMPANYADMIN',
  'COMPANY_MANAGER', 'company_manager',
  // 中文显示值
  '公司管理员', '企业管理员',
]

/**
 * 规范化角色词: 小写 + 去下划线 + 去连字符 + 去空格
 * 用于 "宽松包含" 判定, 避免 SUPER_ADMIN vs SUPERADMIN vs super-admin 反复漏掉.
 */
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/_/g, '')
    .replace(/-/g, '')
    .replace(/\s+/g, '')
}

const NORM_SUPER = new Set(SUPER_ADMIN_ALIASES.map(norm))
const NORM_COMPANY = new Set(COMPANY_ADMIN_ALIASES.map(norm))

/** true if `user` 是 super admin (含历史小写别名). */
export function isSuperAdmin(user) {
  const role = user?.role
  if (!role) {
    // 2026-08-27: 兜底 — 用户名是 "admin" 但 role 缺失时, 视为 super admin (init.sql 默认账号)
    return user?.username && String(user.username).toLowerCase() === 'admin'
  }
  const r = String(role)
  // 先快速精确匹配
  if (SUPER_ADMIN_ALIASES.includes(r)) return true
  // 再规范化匹配 (兼容大小写/下划线/连字符差异)
  if (NORM_SUPER.has(norm(r))) return true
  // 最后兜底: 用户名是 admin → 即使 role 列值异常(如空/USER)也按 super admin 处理
  if (user?.username && String(user.username).toLowerCase() === 'admin') return true
  return false
}

/** true if `user` 是 company admin (本公司的管理员). */
export function isCompanyAdmin(user) {
  // super admin 天然拥有 company admin 权限 (可跨公司管理), 避免 "公司管理 / 用户管理"
  // 两个入口在 super admin 账号下被 isCompanyAdmin 判断为 false 导致隐藏.
  if (isSuperAdmin(user)) return true
  const role = user?.role
  if (!role) return false
  const r = String(role)
  if (COMPANY_ADMIN_ALIASES.includes(r)) return true
  if (NORM_COMPANY.has(norm(r))) return true
  return false
}

/**
 * 解析本次请求应使用的 companyId.
 *  - super admin 用 `selectedCompanyId` (无选择则 0, 后端按 0 返回全量)
 *  - 其它角色强制用 `user.companyId`, 忽略 selectedCompanyId (即使页面 state 有值),
 *    保证每个企业用户只能查自己公司数据.
 *
 * @param {object} user 当前登录用户
 * @param {number|string} [selectedCompanyId] super admin 在 UI 上选中的公司 (可空)
 * @returns {number} 0 表示未限定
 */
export function effectiveCompanyId(user, selectedCompanyId) {
  if (isSuperAdmin(user)) return Number(selectedCompanyId) || 0
  return Number(user?.companyId) || 0
}
