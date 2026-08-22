import { useState, useEffect, useCallback } from 'react';
import {
  Card, Tag, Button, Space, Typography, Switch, Empty, Spin, Alert,
  Modal, Descriptions, Statistic, Row, Col, Tabs, Tooltip, message, Divider,
  Input, Form, List
} from 'antd';
import {
  ReloadOutlined, PlayCircleOutlined, PauseCircleOutlined,
  CheckCircleOutlined, CloseCircleOutlined, SyncOutlined,
  ExclamationCircleOutlined, RocketOutlined, ExperimentOutlined,
  FolderOpenOutlined, GithubOutlined, ThunderboltOutlined,
  ClockCircleOutlined, WarningOutlined, FileTextOutlined,
  EditOutlined, SaveOutlined, UndoOutlined, FolderOutlined
} from '@ant-design/icons';
import api, { getLocalAgentBaseUrl } from '../auth';

const { Title, Text, Paragraph } = Typography;

const STATUS_META = {
  detected:     { color: 'blue',       label: 'Detected',     icon: <ExclamationCircleOutlined /> },
  analyzing:    { color: 'processing', label: 'Analyzing',    icon: <SyncOutlined spin /> },
  proposed:     { color: 'cyan',       label: 'Proposed',     icon: <ExperimentOutlined /> },
  applying:     { color: 'gold',       label: 'Applying',     icon: <RocketOutlined /> },
  needs_review: { color: 'orange',     label: 'Needs Review', icon: <ExclamationCircleOutlined /> },
  fixed:        { color: 'green',      label: 'Fixed',        icon: <CheckCircleOutlined /> },
  failed:       { color: 'red',        label: 'Failed',       icon: <CloseCircleOutlined /> },
  ignored:      { color: 'default',    label: 'Ignored',      icon: <PauseCircleOutlined /> }
};

function StatusTag({ status }) {
  const m = STATUS_META[status] || { color: 'default', label: status, icon: null };
  return <Tag color={m.color} icon={m.icon}>{m.label}</Tag>;
}

function timeAgo(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function IssueCard({ issue, onAction, busy }) {
  const fp = issue.fixProposal;
  return (
    <Card
      size="small"
      style={{ marginBottom: 12, borderColor: '#333' }}
      title={
        <Space>
          <Text code style={{ fontSize: 12 }}>{issue.id}</Text>
          <StatusTag status={issue.status} />
          {issue.kind && <Tag>{issue.kind}</Tag>}
          <Text type="secondary" style={{ fontSize: 11 }}>
            <ClockCircleOutlined /> {timeAgo(issue.createdAt)}
          </Text>
        </Space>
      }
      extra={
        <Space size="small">
          {issue.status === 'needs_review' && (
            <>
              <Button size="small" type="primary"
                disabled={busy}
                onClick={() => onAction('apply', issue.id)}>Apply</Button>
              <Button size="small" danger
                disabled={busy}
                onClick={() => onAction('reject', issue.id)}>Reject</Button>
            </>
          )}
          {(issue.status === 'failed' || issue.status === 'needs_review') && (
            <Button size="small"
              disabled={busy}
              onClick={() => onAction('retry', issue.id)}>Retry</Button>
          )}
          {issue.status !== 'ignored' && issue.status !== 'fixed' && (
            <Button size="small"
              disabled={busy}
              onClick={() => onAction('ignore', issue.id)}>Ignore</Button>
          )}
        </Space>
      }
    >
      <Descriptions size="small" column={1} bordered>
        <Descriptions.Item label="Exception">
          <Text code style={{ fontSize: 12 }}>{issue.payload?.exceptionClass || '—'}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="Message">
          <Text style={{ fontSize: 12 }}>{issue.payload?.message || '—'}</Text>
        </Descriptions.Item>
        {issue.payload?.count && (
          <Descriptions.Item label="Occurrences">
            <Tag color="blue">{issue.payload.count}× in last 10 min</Tag>
          </Descriptions.Item>
        )}
        {issue.diagnosis && (
          <Descriptions.Item label="Diagnosis">
            <Paragraph style={{ marginBottom: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {issue.diagnosis}
            </Paragraph>
          </Descriptions.Item>
        )}
        {issue.error && (
          <Descriptions.Item label="Error">
            <Text type="warning" style={{ fontSize: 12 }}>{issue.error}</Text>
          </Descriptions.Item>
        )}
        {fp?.file_path && (
          <Descriptions.Item label="Proposed file">
            <Text code style={{ fontSize: 11 }}>{fp.file_path}</Text>
            {fp.lines_added != null && (
              <Tag color="green" style={{ marginLeft: 8 }}>+{fp.lines_added}</Tag>
            )}
            {fp.lines_deleted != null && (
              <Tag color="red" style={{ marginLeft: 4 }}>−{fp.lines_deleted}</Tag>
            )}
          </Descriptions.Item>
        )}
        {issue.fixBranch && (
          <Descriptions.Item label="Branch">
            <Tag icon={<GithubOutlined />} color="purple">{issue.fixBranch}</Tag>
          </Descriptions.Item>
        )}
      </Descriptions>
      {fp?.unified_diff && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', color: '#888', fontSize: 12 }}>
            <FileTextOutlined /> Show diff
          </summary>
          <pre style={{
            background: '#1a1a1a', color: '#ddd', padding: 8, borderRadius: 4,
            fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto', marginTop: 8
          }}>
            {fp.unified_diff}
          </pre>
          {fp.predicted_effect && (
            <Alert
              style={{ marginTop: 8 }}
              type="info" showIcon
              message={<span style={{ fontSize: 12 }}>{fp.predicted_effect}</span>}
            />
          )}
        </details>
      )}
    </Card>
  );
}

export default function MonitorPanel() {
  const [status, setStatus] = useState(null);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [activeTabKey, setActiveTabKey] = useState('active');
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testExClass, setTestExClass] = useState('java.lang.NullPointerException');
  const [testMessage, setTestMessage] = useState('smoke test from MonitorPanel');

  // Settings modal state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftRepoRoot, setDraftRepoRoot] = useState('');
  const [browsePath, setBrowsePath] = useState('');
  const [browseEntries, setBrowseEntries] = useState([]);
  const [browseLoading, setBrowseLoading] = useState(false);

  const baseURL = getLocalAgentBaseUrl();

  const refresh = useCallback(async () => {
    try {
      const [s, i] = await Promise.all([
        api.get('/api/monitor/status', { baseURL }),
        api.get('/api/monitor/issues', { baseURL }).catch(() => ({ data: { issues: [] } }))
      ]);
      setStatus(s.data);
      setIssues(i.data?.issues || []);
    } catch (e) {
      setStatus({ enabled: false, running: false });
    } finally {
      setLoading(false);
    }
  }, [baseURL]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  const handleAction = async (action, id) => {
    setBusy(true);
    try {
      const url = `/api/monitor/issues/${id}/${action}`;
      await api.post(url, {}, { baseURL });
      message.success(`${action} ok`);
      await refresh();
    } catch (e) {
      message.error(`${action} failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleTestTrigger = async () => {
    setBusy(true);
    try {
      await api.post('/api/monitor/test-trigger', {
        exceptionClass: testExClass,
        message: testMessage
      }, { baseURL });
      message.success('Test trigger fired. Watch the active list.');
      setTestModalOpen(false);
      await refresh();
    } catch (e) {
      message.error('Test trigger failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleAutoRestartToggle = async (checked) => {
    try {
      await api.post('/api/monitor/auto-restart', { enabled: checked }, { baseURL });
      message.success(checked ? 'Auto-restart enabled' : 'Auto-restart disabled');
      await refresh();
    } catch (e) {
      message.error('Toggle failed: ' + e.message);
    }
  };

  const handleMonitorToggle = async (checked) => {
    setBusy(true);
    try {
      const res = await api.post('/api/monitor/toggle', { enabled: checked }, { baseURL });
      message.success(checked ? 'Monitor enabled' : 'Monitor disabled');
      await refresh();
      if (!res.data?.running && checked) {
        message.warning('Monitor enabled but tailer not running — check server console.');
      }
    } catch (e) {
      const status = e.response?.status;
      message.error(status === 503 ? 'Monitor module not loaded (set AUTOBOT_MONITOR=1 in server env)' : 'Toggle failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  // ── Settings: open the modal and seed with current values ──
  const openSettings = () => {
    setDraftRepoRoot(status.repoRoot || '');
    setBrowsePath(status.repoRoot || '/');
    setSettingsOpen(true);
    fetchBrowseEntries(status.repoRoot || '/');
  };

  const fetchBrowseEntries = async (path) => {
    setBrowseLoading(true);
    try {
      const res = await api.post('/api/local/workspace/list', { path, extensions: '' }, { baseURL });
      setBrowseEntries(res.data?.files || []);
    } catch (e) {
      setBrowseEntries([]);
    } finally {
      setBrowseLoading(false);
    }
  };

  const validatePath = async (dirPath) => {
    try {
      const res = await api.post('/api/local/workspace/validate', { path: dirPath }, { baseURL });
      return res.data.valid === true;
    } catch (e) {
      console.warn('[Monitor] Validation failed:', e);
      return false;
    }
  };

  const handleSaveConfig = async () => {
    if (!draftRepoRoot.trim()) {
      message.error('Please enter a project path');
      return;
    }
    setBusy(true);
    try {
      const isValid = await validatePath(draftRepoRoot.trim());
      if (!isValid) {
        message.error('Invalid path: directory does not exist or is not accessible');
        setBusy(false);
        return;
      }
      const res = await api.post('/api/monitor/config', { repoRoot: draftRepoRoot.trim() }, { baseURL });
      message.success(`Switched to ${res.data.config.repoRoot}`);
      setSettingsOpen(false);
      await refresh();
    } catch (e) {
      const errMsg = e.response?.data?.error || e.message;
      message.error(`Switch failed: ${errMsg}`);
    } finally {
      setBusy(false);
    }
  };

  const handleResetConfig = async () => {
    setBusy(true);
    try {
      const res = await api.post('/api/monitor/config/reset', {}, { baseURL });
      message.success(`Reset to ${res.data.config.repoRoot}`);
      await refresh();
    } catch (e) {
      message.error('Reset failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>;
  }

  if (!status?.enabled) {
    return (
      <div style={{ padding: 24 }}>
        <Alert
          type="warning" showIcon
          message="Monitor is disabled"
          description="Set AUTOBOT_MONITOR=1 in the local agent's environment to enable it, then restart the local agent."
          style={{ marginBottom: 16 }}
        />
      </div>
    );
  }

  if (!status?.running) {
    return (
      <div style={{ padding: 24 }}>
        <Alert
          type="error" showIcon
          message="Monitor is enabled but not running"
          description="Check the local agent console for startup errors. The monitor requires chokidar and simple-git to be installed."
        />
      </div>
    );
  }

  const counts = issues.reduce((acc, i) => {
    acc[i.status] = (acc[i.status] || 0) + 1;
    return acc;
  }, {});
  const active = issues.filter(i => ['detected', 'analyzing', 'proposed', 'applying', 'needs_review'].includes(i.status));
  const history = issues.filter(i => ['fixed', 'failed', 'ignored'].includes(i.status))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <Row gutter={16} align="middle" style={{ marginBottom: 16 }}>
        <Col flex="auto">
          <Title level={3} style={{ margin: 0 }}>
            <RocketOutlined /> autobot-monitor
            {status.running
              ? <Tag color="green" style={{ marginLeft: 12, fontSize: 12 }}>RUNNING</Tag>
              : <Tag color="default" style={{ marginLeft: 12, fontSize: 12 }}>STOPPED</Tag>}
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Watching <Text code style={{ fontSize: 11 }}>java-backend/logs/</Text> for recurring defects
          </Text>
        </Col>
        <Col>
          <Space>
            <Tooltip title={status.running ? 'Stop the monitor (persists across restarts)' : 'Start the monitor (persists across restarts)'}>
              <Switch
                checked={!!status.running}
                onChange={handleMonitorToggle}
                disabled={busy || !status.available}
                checkedChildren="ON" unCheckedChildren="OFF"
              />
            </Tooltip>
            <Tooltip title="Fire a fake exception to verify the analysis round-trip works">
              <Button icon={<ExperimentOutlined />} onClick={() => setTestModalOpen(true)} disabled={busy || !status.running}>
                Test trigger
              </Button>
            </Tooltip>
            <Tooltip title="Refresh">
              <Button icon={<ReloadOutlined />} onClick={refresh} disabled={busy} />
            </Tooltip>
          </Space>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={4}><Card size="small"><Statistic title="Active" value={active.length} valueStyle={{ color: active.length ? '#faad14' : '#888' }} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="Needs review" value={counts.needs_review || 0} valueStyle={{ color: counts.needs_review ? '#fa8c16' : '#888' }} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="Fixed" value={counts.fixed || 0} valueStyle={{ color: '#52c41a' }} prefix={<CheckCircleOutlined />} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="Failed" value={counts.failed || 0} valueStyle={{ color: '#ff4d4f' }} prefix={<CloseCircleOutlined />} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="Ignored" value={counts.ignored || 0} /></Card></Col>
        <Col span={4}><Card size="small">
          <div style={{ fontSize: 12, color: '#888' }}>Auto-restart after fix</div>
          <Switch checked={status.autoRestart} onChange={handleAutoRestartToggle} disabled={busy}
            checkedChildren="ON" unCheckedChildren="OFF" />
        </Card></Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card size="small">
          <div style={{ fontSize: 12, color: '#888' }}>ReAct 续接追加</div>
          <div style={{ fontSize: 22, color: '#1677ff' }}>{status.reactCounters?.appends ?? '—'}</div>
        </Card></Col>
        <Col span={6}><Card size="small">
          <div style={{ fontSize: 12, color: '#888' }}>ReAct 补偿成功</div>
          <div style={{ fontSize: 22, color: '#52c41a' }}>{status.reactCounters?.compensated ?? '—'}</div>
        </Card></Col>
        <Col span={6}><Card size="small">
          <div style={{ fontSize: 12, color: '#888' }}>ReAct 补偿失败</div>
          <div style={{ fontSize: 22, color: (status.reactCounters?.compensationFailed || 0) ? '#ff4d4f' : '#888' }}>
            {status.reactCounters?.compensationFailed ?? '—'}
          </div>
        </Card></Col>
        <Col span={6}><Card size="small">
          <div style={{ fontSize: 12, color: '#888' }}>ReAct 续接裁决灰度</div>
          <div style={{ fontSize: 14, lineHeight: '22px' }}>
            <Tag>decide-next</Tag>
          </div>
        </Card></Col>
      </Row>

      <Card
        size="small"
        style={{ marginBottom: 16 }}
        title={<><FolderOpenOutlined /> Target project</>}
        extra={
          <Space>
            <Tooltip title="Change which project the monitor watches">
              <Button size="small" icon={<EditOutlined />} onClick={() => setSettingsOpen(true)} disabled={busy}>
                Change…
              </Button>
            </Tooltip>
            <Tooltip title="Reset to env default (AUTOBOT_REPO_ROOT)">
              <Button size="small" icon={<UndoOutlined />} onClick={handleResetConfig} disabled={busy} />
            </Tooltip>
          </Space>
        }
      >
        <Descriptions size="small" column={2} colon={false}>
          <Descriptions.Item label={<><FolderOpenOutlined /> Repo root</>}>
            <Text code style={{ fontSize: 11 }}>
              {(status.repoRoot || '').replace(process.env.HOME || '~', '~')}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label={<><FileTextOutlined /> Logs dir</>}>
            <Text code style={{ fontSize: 11 }}>
              {(status.logsDir || (status.repoRoot ? status.repoRoot + '/java-backend/logs' : '')).replace(process.env.HOME || '~', '~')}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label={<><FileTextOutlined /> Issue store</>}>
            <Text code style={{ fontSize: 11 }}>{(status.storePath || '').replace(process.env.HOME || '~', '~')}</Text>
          </Descriptions.Item>
          <Descriptions.Item label={<><ThunderboltOutlined /> Trigger</>}>
            <Text style={{ fontSize: 12 }}>≥2 same-exception repeats in 10 min</Text>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Tabs
        activeKey={activeTabKey}
        onChange={setActiveTabKey}
        items={[
          {
            key: 'active',
            label: <span><ExclamationCircleOutlined /> Active {active.length ? <Tag color="orange">{active.length}</Tag> : null}</span>,
            children: active.length === 0
              ? <Empty description="No active issues" style={{ padding: 40 }} />
              : active.map(i => <IssueCard key={i.id} issue={i} onAction={handleAction} busy={busy} />)
          },
          {
            key: 'history',
            label: <span><ClockCircleOutlined /> History {history.length ? <Tag>{history.length}</Tag> : null}</span>,
            children: history.length === 0
              ? <Empty description="No historical issues" style={{ padding: 40 }} />
              : history.map(i => <IssueCard key={i.id} issue={i} onAction={handleAction} busy={busy} />)
          }
        ]}
      />

      <Modal
        title="Fire test exception"
        open={testModalOpen}
        onCancel={() => setTestModalOpen(false)}
        onOk={handleTestTrigger}
        confirmLoading={busy}
        okText="Fire"
      >
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="This creates a synthetic issue and starts an analysis round-trip. It will appear in the Active tab. Use this to verify the monitor end-to-end without waiting for a real exception."
        />
        <div style={{ marginBottom: 8 }}>
          <Text>Exception class</Text>
          <input
            value={testExClass}
            onChange={e => setTestExClass(e.target.value)}
            style={{ width: '100%', padding: 6, background: '#1a1a1a', color: '#eee', border: '1px solid #333', borderRadius: 4, marginTop: 4 }}
          />
        </div>
        <div>
          <Text>Message</Text>
          <textarea
            value={testMessage}
            onChange={e => setTestMessage(e.target.value)}
            rows={3}
            style={{ width: '100%', padding: 6, background: '#1a1a1a', color: '#eee', border: '1px solid #333', borderRadius: 4, marginTop: 4, fontFamily: 'monospace' }}
          />
        </div>
      </Modal>

      {/* ── Settings: change target project ── */}
      <Modal
        title={<><FolderOpenOutlined /> Change target project</>}
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        onOk={handleSaveConfig}
        confirmLoading={busy}
        okText="Switch & retarget"
        width={640}
      >
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="The monitor will stop watching the current log files and start watching the new project's. Issue history and config are preserved; in-flight analyses continue using the old path until they finish."
        />
        <Form layout="vertical">
          <Form.Item label="Project root (absolute path)">
            <Input
              value={draftRepoRoot}
              onChange={e => setDraftRepoRoot(e.target.value)}
              placeholder="/path/to/your/project"
              addonBefore={<FolderOutlined />}
            />
          </Form.Item>
          <Form.Item label="Or browse" style={{ marginBottom: 8 }}>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                value={browsePath}
                onChange={e => setBrowsePath(e.target.value)}
                onPressEnter={() => fetchBrowseEntries(browsePath)}
                placeholder="/"
              />
              <Button onClick={() => fetchBrowseEntries(browsePath)} loading={browseLoading}>Go</Button>
            </Space.Compact>
          </Form.Item>
          <div style={{
            background: '#1a1a1a', border: '1px solid #333', borderRadius: 4,
            maxHeight: 240, overflow: 'auto', padding: 4
          }}>
            <Spin spinning={browseLoading}>
              {browseEntries.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No entries" style={{ padding: 16 }} />
              ) : (
                <List
                  size="small"
                  dataSource={browseEntries.filter(e => !e.isFile)}
                  locale={{ emptyText: 'No subdirectories' }}
                  renderItem={item => (
                    <List.Item
                      style={{ cursor: 'pointer', padding: '4px 8px' }}
                      onClick={() => {
                        const next = item.absolute || item.path;
                        setBrowsePath(next);
                        setDraftRepoRoot(next);
                        fetchBrowseEntries(next);
                      }}
                    >
                      <Space>
                        <FolderOutlined style={{ color: '#1677ff' }} />
                        <Text style={{ fontSize: 12 }}>{item.path}</Text>
                      </Space>
                    </List.Item>
                  )}
                />
              )}
            </Spin>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
