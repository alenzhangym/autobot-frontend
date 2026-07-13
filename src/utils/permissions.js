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

const SUPER_ADMIN_ALIASES = ['SUPER_ADMIN', 'admin', 'superadmin']
const COMPANY_ADMIN_ALIASES = ['COMPANY_ADMIN', 'company_admin']

/** true if `user` 是 super admin (含历史小写别名). */
export function isSuperAdmin(user) {
  const role = user?.role
  if (!role) return false
  return SUPER_ADMIN_ALIASES.includes(role) || SUPER_ADMIN_ALIASES.includes(String(role).toLowerCase())
}

/** true if `user` 是 company admin (本公司的管理员). */
export function isCompanyAdmin(user) {
  const role = user?.role
  if (!role) return false
  return COMPANY_ADMIN_ALIASES.includes(role) || COMPANY_ADMIN_ALIASES.includes(String(role).toLowerCase())
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
