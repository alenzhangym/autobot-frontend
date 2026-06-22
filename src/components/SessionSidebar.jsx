import React, { useState, useEffect } from 'react';
import { Button, Menu, Avatar, Tooltip, Dropdown, Space, Tag } from 'antd';
import { PlusOutlined, FileTextOutlined, DatabaseOutlined, LogoutOutlined, SettingOutlined, TeamOutlined, DeleteOutlined, PlayCircleOutlined, DownOutlined, ShopOutlined, FileSearchOutlined, CodeOutlined, MessageOutlined, SendOutlined, DashboardOutlined, InboxOutlined, ToolOutlined, UsergroupAddOutlined, CrownOutlined, LinkOutlined, UploadOutlined, SnippetsOutlined, ShoppingCartOutlined, AuditOutlined, SearchOutlined, ContainerOutlined, RocketOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useUserStore } from '../store/useUserStore';
import api, { getLocalAgentBaseUrl } from '../auth';
import { CHANNELS as ALL_CHANNELS, CHANNELS_BY_KEY, getTaskTypeByChannel } from '../constants/taskTypes.jsx';

function getChannelIcon(channel) {
  const ch = ALL_CHANNELS.find(c => c.key === channel);
  return ch ? ch.antIcon : <MessageOutlined />;
}

export default function SessionSidebar({
  sessions,
  scheduledTasks,
  sessionId,
  activeTab,
  siderCollapsed,
  startNewSession,
  loadSession,
  setActiveTab,
  handleDeleteSession,
  handleExecuteTask,
  handleDeleteTask,
  user,
  logout,
  setShowSettings,
  setShowUsersManagement,
  setShowCompanyManagement
}) {
  const { t } = useTranslation()
  const { companyChannels } = useUserStore()
  const isSuper = user?.role === 'SUPER_ADMIN' || user?.role?.toLowerCase() === 'admin' || user?.role?.toLowerCase() === 'superadmin'
  const CHANNELS = isSuper || companyChannels.length === 0
    ? ALL_CHANNELS
    : ALL_CHANNELS.filter(ch => companyChannels.includes(ch.key))
  
  const hasErpChannel = CHANNELS.some(ch => ch.key === 'erp');
  const hasDatabaseChannel = CHANNELS.some(ch => ch.key === 'database_analysis');

  // Probe monitor availability once on mount; cheap, no polling
  const [monitorAvailable, setMonitorAvailable] = useState(false)
  const [monitorRunning, setMonitorRunning] = useState(false)
  useEffect(() => {
    let cancelled = false
    api.get('/api/monitor/status', { baseURL: getLocalAgentBaseUrl() })
      .then(res => {
        if (cancelled) return
        setMonitorAvailable(!!res.data?.available)
        setMonitorRunning(!!res.data?.running)
      })
      .catch(() => {
        if (cancelled) return
        setMonitorAvailable(false)
        setMonitorRunning(false)
      })
    return () => { cancelled = true }
  }, [])

  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const safeScheduledTasks = Array.isArray(scheduledTasks) ? scheduledTasks : [];

  const sidebarItems = safeSessions.map(s => ({
    key: s.id,
    icon: <span style={{ opacity: 0.75 }}>{getChannelIcon(s.channel)}</span>,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {s.title || t('nav.newChat')}
        </span>
        <DeleteOutlined
          onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id); }}
          style={{ fontSize: 10, color: '#555', marginLeft: 8, flexShrink: 0 }}
        />
      </div>
    )
  }));

  const scheduledTaskItems = safeScheduledTasks.map(t => ({
    key: 'sched-' + t.id,
    icon: <span style={{ opacity: 0.6 }}>⏰</span>,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {t.name || t.title || 'Scheduled Task'}
        </span>
        <PlayCircleOutlined
          onClick={(e) => { e.stopPropagation(); handleExecuteTask(t); }}
          style={{ fontSize: 12, color: '#1677ff', marginLeft: 8, flexShrink: 0 }}
        />
        <DeleteOutlined
          onClick={(e) => { e.stopPropagation(); handleDeleteTask(t.id); }}
          style={{ fontSize: 10, color: '#555', marginLeft: 6, flexShrink: 0 }}
        />
      </div>
    )
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '16px 12px 8px' }}>
        <Dropdown
          menu={{
            items: CHANNELS.map(ch => ({
              key: ch.key,
              icon: ch.antIcon,
              label: <div><span style={{ fontWeight: 500 }}>{ch.label}</span><div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>{ch.desc}</div></div>,
              onClick: () => startNewSession(ch.key)
            })),
          }}
          trigger={['click']}
          placement="bottomLeft"
        >
          <Button block
            style={{ background: '#1a1a1a', borderColor: '#2a2a2a', color: '#ccc', borderRadius: 20, textAlign: 'left', justifyContent: 'flex-start' }}>
            <PlusOutlined /> {t('nav.newChat')} <DownOutlined style={{ fontSize: 10, marginLeft: 'auto' }} />
          </Button>
        </Dropdown>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 4px', display: 'flex', flexDirection: 'column' }} className="custom-scrollbar">
        <div style={{ padding: '8px 8px 4px', fontSize: 11, color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Recent
        </div>
        <Menu
          mode="inline" theme="dark" selectedKeys={activeTab === 'chat' && !sessionId?.startsWith('sched-') ? [sessionId] : []}
          onSelect={({ key }) => { setActiveTab('chat'); loadSession(key); }}
          items={sidebarItems}
          style={{ background: 'transparent', border: 'none', flexShrink: 0 }}
        />

        <div style={{ padding: '16px 8px 4px', fontSize: 11, color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          My Scheduled Tasks
        </div>
        <Menu
          mode="inline" theme="dark" selectedKeys={activeTab === 'chat' && sessionId?.startsWith('sched-') ? [sessionId] : []}
          onSelect={({ key }) => { setActiveTab('chat'); loadSession(key); }}
          items={scheduledTaskItems}
          style={{ background: 'transparent', border: 'none', flexShrink: 0 }}
        />
      </div>

    <div style={{ padding: '12px', borderTop: '1px solid #1f1f1f' }}>
      <Menu
        mode="inline" theme="dark"
        selectedKeys={[activeTab]}
        onSelect={({ key }) => {
          setActiveTab(key);
        }}
        items={[
          ...(isSuper && monitorAvailable ? [
            { key: 'monitor', icon: <RocketOutlined />, label: <Space size={4}>autobot-monitor{monitorRunning && <Tag color="green" style={{ fontSize: 10, marginInlineEnd: 0, lineHeight: '14px' }}>live</Tag>}</Space> },
            { type: 'divider' }
          ] : []),
          { key: 'documents', icon: <FileTextOutlined />, label: t('nav.companyDocuments') },
          ...(((user?.role === 'SUPER_ADMIN' || user?.role === 'COMPANY_ADMIN') && hasErpChannel) ? [
            { key: 'dashboard', icon: <DashboardOutlined />, label: t('erp.dashboard') },
            { type: 'divider' },
            { key: 'erp_trade', icon: <ShopOutlined />, label: '进销存交易',
              children: [
                { key: 'sales_orders', icon: <SnippetsOutlined />, label: '销售单管理' },
                { key: 'purchase_orders', icon: <ShoppingCartOutlined />, label: '采购单管理' },
                { key: 'inbound_orders', icon: <InboxOutlined />, label: t('erp.inboundOrders') },
                { key: 'outbound_orders', icon: <SendOutlined />, label: t('erp.outboundOrders') },
                { key: 'reconciliations', icon: <AuditOutlined />, label: '对账单管理' },
              ]
            },
            { key: 'erp_data', icon: <DatabaseOutlined />, label: '基础数据',
              children: [
                { key: 'parts', icon: <ToolOutlined />, label: t('erp.parts') },
                { key: 'inventory', icon: <ContainerOutlined />, label: '库存管理 (Admin)' },
                { key: 'customers', icon: <TeamOutlined />, label: t('erp.customers') },
                { key: 'suppliers', icon: <UsergroupAddOutlined />, label: t('erp.suppliers') },
                { key: 'customer_part_mappings', icon: <LinkOutlined />, label: '客户料号映射' },
                { key: 'import_product_relation', icon: <UploadOutlined />, label: '导入产品关系' },
                { key: 'audit_logs', icon: <FileSearchOutlined />, label: '审计日志 (Admin)' },
                { key: 'erp', icon: <ShopOutlined />, label: t('erp.dataManagement') },
              ]
            }
          ] : []),
          ...(((user?.role === 'SUPER_ADMIN' || user?.role === 'COMPANY_ADMIN') && hasDatabaseChannel) ? [
            { key: 'databases', icon: <DatabaseOutlined />, label: t('nav.databases') }
          ] : [])
        ]}
        style={{ background: 'transparent', border: 'none', marginBottom: 12, padding: 0 }}
      />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', flex: 1 }}>
            <Avatar size={28} style={{ background: '#1677ff', fontSize: 12, flexShrink: 0 }}>
              {user?.username?.charAt(0).toUpperCase()}
            </Avatar>
            <div style={{ overflow: 'hidden', flex: 1 }}>
              <Tooltip title={user?.username} placement="topLeft">
                <div style={{ color: '#e3e3e3', fontSize: 13, fontWeight: 600, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user?.username}
                </div>
              </Tooltip>
              <div style={{ color: '#666', fontSize: 11, textTransform: 'capitalize', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user?.role?.toLowerCase()}
              </div>
            </div>
          </div>
          <Tooltip title={t('nav.logout')}>
            <Button type="text" icon={<LogoutOutlined />} onClick={logout} style={{ color: '#666', flexShrink: 0, marginLeft: 4 }} size="small" />
          </Tooltip>
        </div>
        <Button block type="text" icon={<SettingOutlined />} onClick={() => setShowSettings(true)} style={{ color: '#888', textAlign: 'left', justifyContent: 'flex-start', borderRadius: 8 }}>{t('nav.settings')}</Button>
        {user?.role === 'SUPER_ADMIN' && (
          <Button block type="text" icon={<CrownOutlined />} onClick={() => setShowCompanyManagement(true)} style={{ color: '#888', textAlign: 'left', justifyContent: 'flex-start', borderRadius: 8, marginTop: 4 }}>公司管理</Button>
        )}
        {(user?.role === 'SUPER_ADMIN' || user?.role === 'COMPANY_ADMIN') && (
          <Button block type="text" icon={<TeamOutlined />} onClick={() => setShowUsersManagement(true)} style={{ color: '#888', textAlign: 'left', justifyContent: 'flex-start', borderRadius: 8, marginTop: 4 }}>{t('nav.userManagement')}</Button>
        )}
      </div>
    </div>
  );
}