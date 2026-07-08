import { useState, useEffect, useRef } from 'react';
import { Select, Spin } from 'antd';
import api from '../auth';

/**
 * 通用实体选择器 — 从后端 /crm/{entity} 拉取列表，支持关键词搜索，只能选择系统中存在的记录。
 *
 * Props:
 * - entity: 后端实体路径名 (如 'customers' / 'contracts' / 'opportunities' / 'payment-plans' / 'leads')
 * - value: 当前选中的 id (受控)
 * - onChange: (id, option) => void
 * - companyId: 租户ID
 * - labelField: 用于显示的字段名 (默认 'name')
 * - subLabelField: 副标签字段 (可选，如 'contract_number')
 * - placeholder
 * - width
 * - disabled
 */
export default function EntityPicker({
  entity, value, onChange, companyId,
  labelField = 'name', subLabelField = null,
  placeholder = '搜索选择', width = 280, disabled = false,
}) {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchKey, setSearchKey] = useState('');
  const fetchRef = useRef(0);

  // 初次加载：如果有 value，把对应记录拉出来显示
  useEffect(() => {
    if (value != null && value !== '') {
      // 在已有 options 中找，找不到才请求
      const exists = options.find(o => o.value === value);
      if (!exists) {
        api.get(`/crm/${entity}/${value}`, { params: { companyId: companyId || 0 } })
          .then(res => {
            const body = res.data?.data || res.data;
            const row = body?.data || body;
            if (row && row.id != null) {
              setOptions(prev => {
                if (prev.find(o => o.value === row.id)) return prev;
                return [{ value: row.id, label: buildLabel(row), _row: row }, ...prev];
              });
            }
          })
          .catch(() => {});
      }
    }
  }, [value, entity, companyId]);

  // 搜索
  const handleSearch = (key) => {
    setSearchKey(key);
    const fetchId = ++fetchRef.current;
    setLoading(true);
    const params = { page: 1, size: 30, companyId: companyId || 0 };
    if (key) params.keyword = key;
    api.get(`/crm/${entity}`, { params })
      .then(res => {
        if (fetchId !== fetchRef.current) return; // 过期响应丢弃
        const body = res.data?.data || res.data;
        const rows = body?.data || [];
        const opts = rows.map(r => ({ value: r.id, label: buildLabel(r), _row: r }));
        // 合并：保留已选中的 option，避免选中后列表消失
        setOptions(prev => {
          const sel = prev.find(o => o.value === value);
          return sel ? [sel, ...opts.filter(o => o.value !== sel.value)] : opts;
        });
      })
      .catch(() => {})
      .finally(() => { if (fetchId === fetchRef.current) setLoading(false); });
  };

  const buildLabel = (row) => {
    const main = row[labelField] ?? row.name ?? `#${row.id}`;
    if (subLabelField && row[subLabelField]) return `${main} (${row[subLabelField]})`;
    return String(main);
  };

  // 初次打开拉一页
  const onDropdownVisibleChange = (open) => {
    if (open && options.length === 0) handleSearch('');
  };

  return (
    <Select
      showSearch
      filterOption={false}
      onSearch={handleSearch}
      onDropdownVisibleChange={onDropdownVisibleChange}
      value={value}
      onChange={(v, opt) => onChange && onChange(v, opt)}
      placeholder={placeholder}
      style={{ width }}
      disabled={disabled}
      notFoundContent={loading ? <Spin size="small" /> : '无数据'}
      options={options}
      allowClear
    />
  );
}
