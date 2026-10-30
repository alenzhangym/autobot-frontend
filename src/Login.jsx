import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Form, Input, Button, Alert, Typography, Space, Modal, Tabs, Select, Divider, Card, ConfigProvider, theme, message } from 'antd'
import { UserOutlined, LockOutlined, SettingOutlined } from '@ant-design/icons'
import api, { login, getBackendHost, setBackendHost, getSuggestedBackendHost } from './auth'

const { Title, Text, Paragraph } = Typography

export default function Login({ onLoginSuccess }) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [backendHost, setLocalBackendHost] = useState('')
  const [activeTab, setActiveTab] = useState('login')

  useEffect(() => {
    setLocalBackendHost(getSuggestedBackendHost())
  }, [])

  const handleLogin = async (values) => {
    setLoading(true)
    setError('')
    setSuccessMsg('')
    try {
      await login(values.username, values.password)
      onLoginSuccess()
    } catch (err) {
      handleError(err, 'Login failed.')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (values) => {
    if (values.password !== values.confirmPassword) {
      setError(t('auth.passwordMismatch'))
      return
    }
    setLoading(true)
    setError('')
    setSuccessMsg('')
    try {
      const payload = {
        username: values.username,
        password: values.password,
        requestedCompanyName: values.requestedCompanyName
      }
      const res = await api.post('/auth/register', payload)
      setSuccessMsg(res.data || t('auth.registerSuccess'))
      setActiveTab('login')
    } catch (err) {
      handleError(err, 'Registration failed.')
    } finally {
      setLoading(false)
    }
  }

  const handleError = (err, defaultMsg) => {
    let errorMsg = defaultMsg
    if (err.response?.data) {
      if (typeof err.response.data === 'string') {
        errorMsg = err.response.data
      } else if (err.response.data.message) {
        errorMsg = err.response.data.message
      } else if (err.response.data.error) {
        errorMsg = err.response.data.error
      } else {
        errorMsg = JSON.stringify(err.response.data)
      }
    } else if (err.message) {
      errorMsg = err.message
    }
    setError(errorMsg)
  }

  const handleSaveSettings = () => {
    const res = setBackendHost(backendHost)
    if (!res.host) {
      message.warning('请填写后端地址')
      return
    }
    setLocalBackendHost(res.host)
    setSettingsVisible(false)
    if (res.requiresLogin) {
      message.info('后端地址已切换，正在返回登录页，请用该后端的账号重新登录')
    } else if (res.switched) {
      message.success('后端地址已切换，当前页面会立即使用新地址')
    } else {
      message.success('后端地址未变化')
    }
  }

  // Reusable input style — overrides AntD with our atelier aesthetic
  const inputStyle = {
    backgroundColor: 'var(--ab-bg)',
    borderColor: 'var(--ab-line)',
    color: 'var(--ab-text)',
    fontFamily: 'var(--ab-font-body)',
    height: 46,
    borderRadius: 3,
  }

  return (
    <ConfigProvider theme={{
      algorithm: theme.darkAlgorithm,
      token: {
        colorPrimary: '#d4a574',
        borderRadius: 3,
        colorBgContainer: '#0e0e0e',
        colorBgElevated: '#181613',
        colorBorder: '#2a2620',
        fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
      },
      components: {
        Tabs: {
          itemColor: '#807a6e',
          itemActiveColor: '#b8b1a3',
          itemSelectedColor: '#d4a574',
          inkBarColor: '#d4a574',
          titleFontSize: 12,
        },
        Modal: {
          contentBg: '#181613',
          headerBg: '#181613',
          titleColor: '#e8e3d8',
        },
        Alert: {
          borderRadiusLG: 3,
        },
      },
    }}>
    <div className="ab-grain" style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--ab-bg)', position: 'relative',
      padding: '40px 20px', overflow: 'hidden'
    }}>
      <div className="ab-grid-bg" />

      {/* Vertical metadata — left */}
      <div style={{
        position: 'absolute',
        left: 28,
        top: '50%',
        transform: 'translateY(-50%)',
        writingMode: 'vertical-rl',
        fontFamily: 'var(--ab-font-mono)',
        fontSize: 10,
        letterSpacing: '0.32em',
        color: 'var(--ab-text-4)',
        textTransform: 'uppercase',
        zIndex: 2,
      }}>
        AUTOBOT · ATELIER COMMAND CENTER · EST. 2026
      </div>

      {/* Top-right metadata */}
      <div style={{
        position: 'absolute',
        right: 28,
        top: 28,
        textAlign: 'right',
        fontFamily: 'var(--ab-font-mono)',
        fontSize: 10,
        letterSpacing: '0.2em',
        color: 'var(--ab-text-4)',
        textTransform: 'uppercase',
        zIndex: 2,
        lineHeight: 1.8,
      }}>
        <div>SECURE CHANNEL</div>
        <div style={{ color: 'var(--ab-copper)' }} className="ab-cursor-blink">STATUS / READY</div>
      </div>

      <Button
        type="default"
        icon={<SettingOutlined />}
        onClick={() => setSettingsVisible(true)}
        style={{
          position: 'absolute',
          bottom: 28,
          right: 28,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'transparent',
          border: '1px solid var(--ab-line)',
          color: 'var(--ab-text-2)',
          fontWeight: 500,
          fontFamily: 'var(--ab-font-mono)',
          fontSize: 11,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          height: 32,
          zIndex: 2,
        }}
      >
        Backend
      </Button>

      <Modal
        title="后端地址设置"
        open={settingsVisible}
        onCancel={() => setSettingsVisible(false)}
        onOk={handleSaveSettings}
        okText="保存"
        cancelText="取消"
      >
        <Paragraph style={{ color: 'var(--ab-text-3)', fontSize: 12, marginBottom: 12 }}>
          默认后端地址为 <span className="ab-code">http://120.26.113.95:8000</span>
          （若页面由后端自己服务、即当前就是 8000 端口，则默认同源）。
          可填完整 URL 或 host:port；地址一旦变化会清空旧登录凭证并回到登录页 ——
          token 是各后端自己签发的，请用新后端的账号重新登录。
          该地址保存在当前页面的 localStorage 里，只对当前主机名/端口生效。
        </Paragraph>
        <Form layout="vertical">
          <Form.Item label={<span className="ab-mono-dim" style={{ fontSize: 10 }}>BACKEND ADDRESS</span>}>
            <Input
              value={backendHost}
              onChange={(e) => setLocalBackendHost(e.target.value)}
              placeholder="http://120.26.113.95:8000"
            />
          </Form.Item>
        </Form>
      </Modal>

      <div style={{
        width: 440, padding: '44px 42px', background: 'var(--ab-surface)',
        border: '1px solid var(--ab-line)', borderRadius: 4,
        boxShadow: 'var(--ab-shadow-2)',
        position: 'relative', zIndex: 2
      }} className="ab-reveal">
        {/* Corner ticks */}
        <span style={{ position: 'absolute', top: 0, left: 0, width: 14, height: 14, borderTop: '1px solid var(--ab-copper)', borderLeft: '1px solid var(--ab-copper)' }} />
        <span style={{ position: 'absolute', top: 0, right: 0, width: 14, height: 14, borderTop: '1px solid var(--ab-copper)', borderRight: '1px solid var(--ab-copper)' }} />
        <span style={{ position: 'absolute', bottom: 0, left: 0, width: 14, height: 14, borderBottom: '1px solid var(--ab-copper)', borderLeft: '1px solid var(--ab-copper)' }} />
        <span style={{ position: 'absolute', bottom: 0, right: 0, width: 14, height: 14, borderBottom: '1px solid var(--ab-copper)', borderRight: '1px solid var(--ab-copper)' }} />

        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            style={{ marginBottom: 20, borderRadius: 3, background: 'rgba(201, 122, 107, 0.08)', border: '1px solid rgba(201, 122, 107, 0.4)' }}
          />
        )}
        {successMsg && (
          <Alert
            message={successMsg}
            type="success"
            showIcon
            style={{ marginBottom: 20, borderRadius: 3, background: 'rgba(138, 154, 110, 0.08)', border: '1px solid rgba(138, 154, 110, 0.4)' }}
          />
        )}

        <div style={{ marginBottom: 32 }}>
          <div className="ab-mono-label" style={{ marginBottom: 18 }}>AUTHENTICATE</div>
          <h1 className="ab-display" style={{ fontSize: 36, fontWeight: 300, marginBottom: 8, letterSpacing: '-0.02em' }}>
            Enter <em>AutoBot</em>
          </h1>
          <div style={{ color: 'var(--ab-text-3)', fontSize: 13, fontFamily: 'var(--ab-font-body)' }}>
            多 Agent 协作平台 · 请使用账号登录
          </div>
        </div>

        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          centered
          items={[
            {
              key: 'login',
              label: 'SIGN IN',
              children: (
                <Form layout="vertical" onFinish={handleLogin} requiredMark={false} style={{ marginTop: 24 }}>
                  <Form.Item
                    name="username"
                    label={<span className="ab-mono-dim" style={{ fontSize: 10 }}>USERNAME</span>}
                    rules={[{ required: true, message: 'Please enter username' }]}
                  >
                    <Input
                      prefix={<UserOutlined style={{ color: 'var(--ab-text-3)' }} />}
                      placeholder={t('auth.username')}
                      size="large"
                      style={inputStyle}
                    />
                  </Form.Item>
                  <Form.Item
                    name="password"
                    label={<span className="ab-mono-dim" style={{ fontSize: 10 }}>PASSWORD</span>}
                    rules={[{ required: true, message: 'Please enter password' }]}
                  >
                    <Input.Password
                      prefix={<LockOutlined style={{ color: 'var(--ab-text-3)' }} />}
                      placeholder={t('auth.password')}
                      size="large"
                      style={inputStyle}
                    />
                  </Form.Item>
                  <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={loading}
                      block
                      size="large"
                      className="ab-btn-copper"
                      style={{ borderRadius: 3, height: 46, fontWeight: 600, letterSpacing: '0.06em' }}
                    >
                      AUTHENTICATE & ENTER
                    </Button>
                  </Form.Item>
                </Form>
              )
            },
            {
              key: 'register',
              label: 'REGISTER',
              children: (
                <Form layout="vertical" onFinish={handleRegister} requiredMark={false} style={{ marginTop: 24 }}>
                  <Form.Item
                    name="username"
                    label={<span className="ab-mono-dim" style={{ fontSize: 10 }}>USERNAME</span>}
                    rules={[{ required: true, message: 'Please enter username' }]}
                  >
                    <Input
                      prefix={<UserOutlined style={{ color: 'var(--ab-text-3)' }} />}
                      placeholder={t('auth.username')}
                      size="large"
                      style={inputStyle}
                    />
                  </Form.Item>
                  <Form.Item
                    name="password"
                    label={<span className="ab-mono-dim" style={{ fontSize: 10 }}>PASSWORD</span>}
                    rules={[{ required: true, message: 'Please enter password' }]}
                  >
                    <Input.Password
                      prefix={<LockOutlined style={{ color: 'var(--ab-text-3)' }} />}
                      placeholder={t('auth.password')}
                      size="large"
                      style={inputStyle}
                    />
                  </Form.Item>
                  <Form.Item
                    name="confirmPassword"
                    label={<span className="ab-mono-dim" style={{ fontSize: 10 }}>CONFIRM PASSWORD</span>}
                    rules={[{ required: true, message: 'Please confirm password' }]}
                  >
                    <Input.Password
                      prefix={<LockOutlined style={{ color: 'var(--ab-text-3)' }} />}
                      placeholder={t('auth.confirmPassword')}
                      size="large"
                      style={inputStyle}
                    />
                  </Form.Item>

                  <Form.Item
                    name="requestedCompanyName"
                    label={<span className="ab-mono-dim" style={{ fontSize: 10 }}>COMPANY NAME</span>}
                    rules={[{ required: true, message: 'Please enter requested company name' }]}
                  >
                    <Input
                      placeholder={t('auth.requestCompany')}
                      size="large"
                      style={inputStyle}
                    />
                  </Form.Item>

                  <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={loading}
                      block
                      size="large"
                      className="ab-btn-copper"
                      style={{ borderRadius: 3, height: 46, fontWeight: 600, letterSpacing: '0.06em' }}
                    >
                      REQUEST ACCESS
                    </Button>
                  </Form.Item>
                  <div style={{
                    textAlign: 'center',
                    marginTop: 16,
                    color: 'var(--ab-text-3)',
                    fontSize: 11.5,
                    fontFamily: 'var(--ab-font-body)',
                    padding: '10px 12px',
                    background: 'rgba(212, 165, 116, 0.04)',
                    border: '1px solid var(--ab-line-soft)',
                    borderLeft: '2px solid var(--ab-copper)',
                    borderRadius: 2,
                    lineHeight: 1.6,
                  }}>
                    Your account and company will require approval from the super admin.
                  </div>
                </Form>
              )
            }
          ]}
        />
      </div>
    </div>
    </ConfigProvider>
  )
}
