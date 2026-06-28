import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Card, Tag, Button, Space, Typography, Statistic, Row, Col, Alert, Spin, Progress, message
} from 'antd';
import {
  ReloadOutlined, BuildOutlined, SyncOutlined, DatabaseOutlined,
  ApartmentOutlined, ShareAltOutlined, FileTextOutlined, ClockCircleOutlined,
  LoadingOutlined
} from '@ant-design/icons';
import api from '../auth';

const { Text } = Typography;

/**
 * 代码图知识库状态面板 (会话内嵌版本).
 * workspaceId / projectRoot 直接取自当前 code 会话, 用户无需手填.
 * 后端按 workspaceId 自动隔离每个会话的子图.
 *
 * @param {string} workspaceId  会话标识 (sessionId)
 * @param {string} projectRoot  会话工作区绝对路径
 */
export default function GraphStatusPanel({ workspaceId = '', projectRoot = '' }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null); // 'build' | 'syncAll' | null
  // P7-7: 全量建库实时进度. phase ∈ 'clearing' | 'building' | 'done' | 'error' | 'idle'
  const [buildProgress, setBuildProgress] = useState(null);
  const pollTimerRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const r = await api.get(`/graph/status`, { params: { workspaceId } });
      setStatus(r.data);
    } catch (e) {
      setStatus({ available: false, error: e?.response?.data?.error || e.message });
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  // P7-7: 拉一次进度 (build 进行中期间每 500ms 调)
  const fetchProgress = useCallback(async () => {
    if (!workspaceId) return null;
    try {
      const r = await api.get(`/graph/build/progress`, { params: { workspaceId } });
      return r.data;
    } catch (e) {
      return null;
    }
  }, [workspaceId]);

  // P7-7: 启停轮询. busy==='build' 时启, 进度 phase 终结 (done/error) 时停.
  useEffect(() => {
    if (busy !== 'build' || !workspaceId) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const p = await fetchProgress();
      if (cancelled) return;
      setBuildProgress(p);
      if (p && (p.phase === 'done' || p.phase === 'error')) {
        // build 结束: 停轮询, 刷状态, 弹提示
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        setBusy(null);
        if (p.phase === 'done') {
          message.success('建库完成');
        } else {
          message.error('建库失败: ' + (p.error || 'unknown'));
        }
        refresh();
      }
    };
    tick(); // 立即拉一次 (避免 500ms 空白)
    pollTimerRef.current = setInterval(tick, 500);
    return () => {
      cancelled = true;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [busy, workspaceId, fetchProgress, refresh]);

  // 首次挂载 + workspaceId 变化时自动拉一次
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [workspaceId]);

  async function build() {
    if (!workspaceId || !projectRoot) { message.warning('当前会话缺少 workspaceId / projectRoot'); return; }
    setBusy('build');
    setBuildProgress({ phase: 'clearing', totalFiles: 0, processedFiles: 0, percent: 0, currentFile: null });
    try {
      await api.post('/graph/build', { workspaceId, projectRoot });
      // 进度轮询逻辑会自己处理 done / error. 这里不等响应完成
      // 也不会清 busy (轮询停时清)
    } catch (e) {
      message.error('建库失败: ' + (e?.response?.data?.error || e.message));
      setBusy(null);
      setBuildProgress(null);
    }
  }

  async function syncAll() {
    if (!workspaceId || !projectRoot) { message.warning('当前会话缺少 workspaceId / projectRoot'); return; }
    setBusy('syncAll');
    try {
      const r = await api.post('/graph/sync-all', { workspaceId, projectRoot });
      const d = r.data;
      message.success(`增量同步: 重建 ${d.rebuilt} 新增 ${d.newFiles} 删除 ${d.deleted} 跳过 ${d.unchanged}`);
      refresh();
    } catch (e) {
      message.error('增量同步失败: ' + (e?.response?.data?.error || e.message));
    } finally { setBusy(null); }
  }

  const available = status?.available === true;
  const err = status?.error;

  return (
    <Card
      size="small"
      title={
        <Space>
          <DatabaseOutlined />
          <span>代码图知识库</span>
          {available
            ? <Tag color="green">已连接</Tag>
            : <Tag color="red">未连接</Tag>}
        </Space>
      }
      extra={
        <Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={refresh} loading={loading}>刷新</Button>
          <Button
            size="small" danger
            icon={<BuildOutlined />}
            onClick={build}
            loading={busy === 'build'}
            disabled={!workspaceId || !projectRoot || busy === 'syncAll'}
          >全量建库</Button>
          <Button
            size="small" type="primary"
            icon={<SyncOutlined />}
            onClick={syncAll}
            loading={busy === 'syncAll'}
            disabled={!workspaceId || !projectRoot || busy === 'build'}
          >增量同步</Button>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <Text type="secondary" style={{ fontSize: 11 }}>会话: </Text>
          <Text code style={{ fontSize: 11 }}>{workspaceId || '—'}</Text>
          {projectRoot && (
            <>
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>目录: </Text>
              <Text code style={{ fontSize: 11 }}>{projectRoot.length > 50 ? '...' + projectRoot.slice(-50) : projectRoot}</Text>
            </>
          )}
        </div>

        {err && <Alert type="error" showIcon message={err} />}

        {/* P7-7: 全量建库进度条. busy==='build' 时渲染, phase=clearing/building/done/error. */}
        {busy === 'build' && buildProgress && (
          <div style={{
            background: '#0a0a0a', border: '1px solid #262626', borderRadius: 8,
            padding: '12px 14px', marginBottom: 4
          }}>
            <Space size="small" style={{ marginBottom: 6 }}>
              {(buildProgress.phase === 'clearing' || buildProgress.phase === 'building') && (
                <LoadingOutlined style={{ color: '#1677ff' }} />
              )}
              {buildProgress.phase === 'clearing' && <Text strong>正在清空旧图谱…</Text>}
              {buildProgress.phase === 'building' && <Text strong>正在解析代码…</Text>}
              {buildProgress.phase === 'done' && <Text strong type="success">建库完成</Text>}
              {buildProgress.phase === 'error' && <Text strong type="danger">建库失败</Text>}
              {buildProgress.phase === 'idle' && <Text type="secondary">准备中…</Text>}
            </Space>
            <Progress
              percent={Math.round(buildProgress.percent || 0)}
              status={buildProgress.phase === 'error' ? 'exception' :
                      buildProgress.phase === 'done' ? 'success' : 'active'}
              strokeWidth={10}
            />
            <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                {buildProgress.currentFile
                  ? <>当前: <Text code style={{ fontSize: 11 }}>{buildProgress.currentFile}</Text></>
                  : buildProgress.phase === 'clearing' ? '清空中…' : '—'}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {buildProgress.processedFiles || 0} / {buildProgress.totalFiles || 0} 个文件
              </Text>
            </div>
          </div>
        )}

        {!available && !err && (
          <Alert type="info" showIcon message="尚未索引 — 点 [增量同步] 自动建库 (后端 FalkorDB 已就绪)." />
        )}

        {available && (
          <Spin spinning={loading}>
            <Row gutter={16}>
              <Col span={6}>
                <Statistic title={<><FileTextOutlined /> 文件</>} value={status.files} />
              </Col>
              <Col span={6}>
                <Statistic title={<><DatabaseOutlined /> 符号</>} value={status.symbols} />
              </Col>
              <Col span={6}>
                <Statistic title={<><ApartmentOutlined /> 调用边</>} value={status.calls} />
              </Col>
              <Col span={6}>
                <Statistic title={<><ShareAltOutlined /> 引用边</>} value={status.references} />
              </Col>
            </Row>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                <ClockCircleOutlined /> 最近索引: {status.lastIndexedAt || '—'}
              </Text>
            </div>
          </Spin>
        )}
      </Space>
    </Card>
  );
}
