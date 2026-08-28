import { useEffect, useState, useCallback } from 'react'
import { Card, Select, Tooltip, Alert, Spin, Tag, Space, Typography, Button, message } from 'antd'
import { ReloadOutlined, StockOutlined, DatabaseOutlined, ApiOutlined } from '@ant-design/icons'
import api from '../auth'

const { Text } = Typography

/**
 * 股票配置 Tab (仅 Super Admin 可见, 在设置弹窗中展示).
 *
 * <p>功能：配置财报数据源 / 实时&日线行情源的偏好。保存后全局生效并持久化,
 * 首选源失败时自动回退另一源。</p>
 *
 * <p>数据接口：</p>
 * <ul>
 *   <li>GET  /api/stock-monitor/data-source — 读取当前偏好</li>
 *   <li>POST /api/stock-monitor/data-source — 保存偏好 ({ fin, quote } 部分)</li>
 * </ul>
 */
const CFG_LABEL = {
  auto: '自动',
  eastmoney: '东方财富优先',
  ths: '同花顺优先',
  tencent: '腾讯优先',
}

export default function StockConfigTab() {
  const [fin, setFin] = useState('auto')
  const [quote, setQuote] = useState('auto')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingKey, setSavingKey] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/stock-monitor/data-source')
      if (r.data?.ok) {
        if (r.data.fin?.dataSource) setFin(r.data.fin.dataSource)
        if (r.data.quote?.dataSource) setQuote(r.data.quote.dataSource)
      }
    } catch (e) {
      // 后端未就绪则保持默认 auto
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const save = async (kind, v) => {
    const setter = kind === 'fin' ? setFin : setQuote
    const prev = kind === 'fin' ? fin : quote
    setter(v)
    const label = CFG_LABEL[v] || v
    setSaving(true)
    setSavingKey(kind)
    try {
      const r = await api.post('/stock-monitor/data-source', { [kind]: v })
      if (r.data?.ok) {
        setter((kind === 'fin' ? r.data.fin?.dataSource : r.data.quote?.dataSource) || v)
        message.success(`已设为「${label}」，首选源失败时自动回退另一源`)
      } else { setter(prev); message.warning('保存失败，已还原') }
    } catch (e) {
      setter(prev)
      message.error('保存数据源失败: ' + (e.response?.data?.message || e.message))
    } finally {
      setSaving(false)
      setSavingKey(null)
    }
  }

  return (
    <div>
      <Alert
        type="info" showIcon
        icon={<StockOutlined />}
        style={{ marginBottom: 16, background: 'rgba(212,165,116,0.08)', borderColor: 'rgba(212,165,116,0.3)' }}
        message={<span style={{ color: '#e8e3d8', fontSize: 12.5 }}>
          为<b style={{ color: '#d4a574' }}>财报</b>与<b style={{ color: '#d4a574' }}>实时/日线行情</b>分别选择首选数据源。保存后全局生效并持久化, 首选源失败时自动回退另一源。
        </span>}
        description={<span style={{ color: '#807a6e', fontSize: 11.5 }}>
          Super Admin 配置一次, 全公司用户共用. 股票监控页将只读此配置, 不再暴露数据源选择器.
        </span>}
      />

      <Card
        loading={loading}
        style={{ background: '#1a1a1a', borderColor: '#333' }}
        headStyle={{ borderBottomColor: '#333', color: '#e8e3d8' }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <DatabaseOutlined style={{ color: '#d4a574' }} />
            <span>数据源偏好</span>
            <Button size="small" type="text" icon={<ReloadOutlined />} onClick={load} loading={loading}
              style={{ color: '#888', marginLeft: 8 }} />
          </div>
        }
        extra={<Tag style={{ fontSize: 11, borderColor: '#2a2620', color: '#807a6e', background: '#0d0d0d' }}>持久化 · 全局生效</Tag>}
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {/* 财报源 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <Tooltip placement="topLeft"
              title="财报数据接口偏好：自动=平衡使用；东方财富优先 / 同花顺优先 = 首选源失败时自动回退另一源。">
              <span style={{ fontSize: 13, color: '#a8a298', fontWeight: 500, width: 80 }}>财报源</span>
            </Tooltip>
            <Select value={fin} onChange={v => save('fin', v)}
              loading={saving && savingKey === 'fin'}
              style={{ width: 200 }} popupMatchSelectWidth={false}
              options={[
                { value: 'auto', label: '自动（默认）' },
                { value: 'eastmoney', label: '东方财富优先' },
                { value: 'ths', label: '同花顺优先' },
              ]} />
            <Tag color="gold" style={{ fontSize: 11, borderColor: 'rgba(212,165,116,0.3)', color: '#d4a574', background: 'rgba(212,165,116,0.08)' }}>
              当前: {CFG_LABEL[fin] || fin}
            </Tag>
            <Text style={{ color: '#5a554d', fontSize: 11.5, flex: 1, minWidth: 200 }}>
              用于财报解读、财务数据下载与缓存. 同花顺需配置 <code style={{ color: '#d4a574' }}>stock-monitor.ths-api-key</code>.
            </Text>
          </div>

          {/* 行情源 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <Tooltip placement="topLeft"
              title="实时/日线行情接口偏好：自动=平衡使用；东方财富 / 同花顺 / 腾讯 优先 = 首选源失败时自动回退另一源。">
              <span style={{ fontSize: 13, color: '#a8a298', fontWeight: 500, width: 80 }}>行情源</span>
            </Tooltip>
            <Select value={quote} onChange={v => save('quote', v)}
              loading={saving && savingKey === 'quote'}
              style={{ width: 200 }} popupMatchSelectWidth={false}
              options={[
                { value: 'auto', label: '自动（默认）' },
                { value: 'eastmoney', label: '东方财富优先' },
                { value: 'ths', label: '同花顺优先' },
                { value: 'tencent', label: '腾讯优先' },
              ]} />
            <Tag color="blue" style={{ fontSize: 11, borderColor: 'rgba(22,119,255,0.3)', color: '#1677ff', background: 'rgba(22,119,255,0.08)' }}>
              当前: {CFG_LABEL[quote] || quote}
            </Tag>
            <Text style={{ color: '#5a554d', fontSize: 11.5, flex: 1, minWidth: 200 }}>
              用于实时行情、日K线、技术指标计算. 失败时按降级链自动回退.
            </Text>
          </div>

          <div style={{ padding: '10px 14px', border: '1px dashed #2a2620', borderRadius: 4, marginTop: 8 }}>
            <div style={{ fontSize: 12, color: '#807a6e', marginBottom: 6 }}>
              <ApiOutlined style={{ marginRight: 6, color: '#d4a574' }} />降级链说明
            </div>
            <Text style={{ color: '#5a554d', fontSize: 11.5, lineHeight: 1.7, display: 'block' }}>
              财报: <code style={{ color: '#d4a574' }}>eastmoney → ths → 本地缓存</code>
              <br />
              行情: <code style={{ color: '#d4a574' }}>eastmoney → tencent → ths</code>
              <br />
              "自动" 档由后端按历史成功率自动选择, 无需手工干预.
            </Text>
          </div>
        </Space>
      </Card>
    </div>
  )
}
