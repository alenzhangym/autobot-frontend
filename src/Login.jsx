import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Form, Input, Button, Alert, Typography, Space, Modal, Tabs, Select, Divider, Card, ConfigProvider, theme } from 'antd'
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
    if (backendHost) {
      setBackendHost(backendHost)
      setSettingsVisible(false)
    }
  }

  return (
    <ConfigProvider theme={{
      algorithm: theme.darkAlgorithm,
      token: { colorPrimary: '#1677ff', borderRadius: 8, colorBgContainer: '#161616', colorBgElevated: '#1a1a1a', colorBorder: '#2a2a2a' }
    }}>
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#0d0d0d', position: 'relative',
      padding: '40px 20px'
    }}>
      <Button 
        type="text" 
        icon={<SettingOutlined style={{ fontSize: 20, color: '#888' }} />} 
        onClick={() => setSettingsVisible(true)}
        style={{ position: 'absolute', top: 20, right: 20 }}
      />
      <Modal
        title="Settings"
        open={settingsVisible}
        onCancel={() => setSettingsVisible(false)}
        onOk={handleSaveSettings}
        okText="Save"
        cancelText="Cancel"
      >
        <Form layout="vertical">
          <Form.Item label="Backend URL (host:port)">
            <Input
              value={backendHost}
              onChange={(e) => setLocalBackendHost(e.target.value)}
              placeholder="e.g. http://192.168.1.100:8000"
            />
          </Form.Item>
        </Form>
      </Modal>

      <div style={{ display: 'flex', maxWidth: 600, width: '100%', gap: 40, flexWrap: 'wrap', margin: '0 auto', justifyContent: 'center' }}>
        <div style={{
          width: 400, padding: '32px', background: '#1a1a1a',
          borderRadius: 16, border: '1px solid #2a2a2a', boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
        }}>
          {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 20, borderRadius: 8 }} />}
          {successMsg && <Alert message={successMsg} type="success" showIcon style={{ marginBottom: 20, borderRadius: 8 }} />}

          <Tabs activeKey={activeTab} onChange={setActiveTab} centered items={[
            {
              key: 'login',
              label: t('auth.login'),
              children: (
                <Form layout="vertical" onFinish={handleLogin} requiredMark={false} style={{ marginTop: 20 }}>
                  <Form.Item name="username" rules={[{ required: true, message: 'Please enter username' }]}>
                    <Input 
                      prefix={<UserOutlined style={{ color: '#888' }} />} 
                      placeholder={t('auth.username')} 
                      size="large" 
                      style={{ backgroundColor: '#161616', borderColor: '#2a2a2a', color: '#e3e3e3' }}
                    />
                  </Form.Item>
                  <Form.Item name="password" rules={[{ required: true, message: 'Please enter password' }]}>
                    <Input.Password 
                      prefix={<LockOutlined style={{ color: '#888' }} />} 
                      placeholder={t('auth.password')} 
                      size="large" 
                      style={{ backgroundColor: '#161616', borderColor: '#2a2a2a', color: '#e3e3e3' }}
                    />
                  </Form.Item>
                  <Form.Item style={{ marginBottom: 0 }}>
                    <Button type="primary" htmlType="submit" loading={loading} block size="large" style={{ borderRadius: 8, height: 44, fontWeight: 600 }}>
                      {t('auth.login')}
                    </Button>
                  </Form.Item>
                </Form>
              )
            },
            {
              key: 'register',
              label: t('auth.register'),
              children: (
                <Form layout="vertical" onFinish={handleRegister} requiredMark={false} style={{ marginTop: 20 }}>
                  <Form.Item name="username" rules={[{ required: true, message: 'Please enter username' }]}>
                    <Input 
                      prefix={<UserOutlined style={{ color: '#888' }} />} 
                      placeholder={t('auth.username')} 
                      size="large" 
                      style={{ backgroundColor: '#161616', borderColor: '#2a2a2a', color: '#e3e3e3' }}
                    />
                  </Form.Item>
                  <Form.Item name="password" rules={[{ required: true, message: 'Please enter password' }]}>
                    <Input.Password 
                      prefix={<LockOutlined style={{ color: '#888' }} />} 
                      placeholder={t('auth.password')} 
                      size="large" 
                      style={{ backgroundColor: '#161616', borderColor: '#2a2a2a', color: '#e3e3e3' }}
                    />
                  </Form.Item>
                  <Form.Item name="confirmPassword" rules={[{ required: true, message: 'Please confirm password' }]}>
                    <Input.Password 
                      prefix={<LockOutlined style={{ color: '#888' }} />} 
                      placeholder={t('auth.confirmPassword')} 
                      size="large" 
                      style={{ backgroundColor: '#161616', borderColor: '#2a2a2a', color: '#e3e3e3' }}
                    />
                  </Form.Item>
                  
                  <Form.Item name="requestedCompanyName" rules={[{ required: true, message: 'Please enter requested company name' }]}>
                    <Input 
                      placeholder={t('auth.requestCompany')} 
                      size="large" 
                      style={{ backgroundColor: '#161616', borderColor: '#2a2a2a', color: '#e3e3e3' }}
                    />
                  </Form.Item>

                  <Form.Item style={{ marginBottom: 0 }}>
                    <Button type="primary" htmlType="submit" loading={loading} block size="large" style={{ borderRadius: 8, height: 44, fontWeight: 600 }}>
                      {t('auth.register')}
                    </Button>
                  </Form.Item>
                  <div style={{ textAlign: 'center', marginTop: 12, color: '#888', fontSize: 12 }}>
                    Your account and company will require approval from the super admin.
                  </div>
                </Form>
              )
            }
          ]} />
        </div>
      </div>
    </div>
    </ConfigProvider>
  )
}
