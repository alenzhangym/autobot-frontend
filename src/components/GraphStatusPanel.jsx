import { useEffect, useState, useCallback } from 'react';
import {
  Card, Tag, Button, Space, Typography, Statistic, Row, Col, Alert, Spin, Progress, message
} from 'antd';
import {
  ReloadOutlined, BuildOutlined, SyncOutlined, DatabaseOutlined,
  ApartmentOutlined, ShareAltOutlined, FileTextOutlined, ClockCircleOutlined,
  LoadingOutlined, DesktopOutlined, GlobalOutlined, ApiOutlined, ExperimentOutlined
} from '@ant-design/icons';
import api from '../auth';
import { ParserFactory } from '../lsp/ParserFactory';
import { TreeSitterParser } from '../lsp/TreeSitterParser';

const { Text } = Typography;

/** P7-9: 支持的语言 (与 LocalLspParser.LANGUAGE_CONFIG 对齐). */
const LANGUAGES = [
  { id: 'typescript', label: 'TypeScript/JS', hint: '.ts/.tsx/.js/.jsx' },
  { id: 'python',     label: 'Python',        hint: '.py' },
  { id: 'go',         label: 'Go',            hint: '.go' },
  { id: 'java',       label: 'Java',          hint: '.java' },
];

/** PR8: languageId → 显示名映射 (用于多语言循环建库时的进度/结果展示). */
const LANG_LABELS = Object.fromEntries(LANGUAGES.map(l => [l.id, l.label]));

/**
 * 代码图知识库状态面板 (会话内嵌版本).
 * workspaceId / projectRoot 直接取自当前 code 会话, 用户无需手填.
 * 后端按 workspaceId 自动隔离每个会话的子图.
 *
 * @param {string} workspaceId  会话标识 (sessionId)
 * @param {string} projectRoot  会话工作区绝对路径
 */
export default function GraphStatusPanel({ workspaceId = '', projectRoot = '' }) {
  const isDesktop = typeof window !== 'undefined' && window.autobotDesktop?.isDesktop === true;
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null); // 'build' | 'syncAll' | null
  // PR8: 多语言支持 — 自动检测项目包含的所有语言, 循环建库.
  // languages: ['java', 'typescript', 'go'] 等; null 表示尚未检测.
  const [languages, setLanguages] = useState(null);
  // P7-9: 前端 LSP 解析实时进度. phase ∈ 'clearing' | 'building' | 'done' | 'error' | 'idle'
  const [buildProgress, setBuildProgress] = useState(null);
  // PR7: 当前生效的 backend ('lsp' | 'tree-sitter' | null). 多语言时取首个语言的探测结果.
  const [backend, setBackend] = useState(null);

  // PR8: projectRoot 变化时自动检测项目包含哪些语言 (monorepo 多语言支持).
  // 通过 TreeSitterParser.detectProjectLanguages 扫 tree 端点按扩展名统计.
  useEffect(() => {
    if (!projectRoot) { setLanguages(null); return; }
    let cancelled = false;
    setLanguages(null); // 检测中
    TreeSitterParser.detectProjectLanguages(projectRoot)
      .then(langs => {
        if (!cancelled) setLanguages(langs.length > 0 ? langs : null);
      })
      .catch(() => {
        if (!cancelled) setLanguages(null);
      });
    return () => { cancelled = true; };
  }, [projectRoot]);

  // PR7/PR8: 探测 backend (多语言时取首个语言的探测结果, 同会话内 LSP 装状态一致).
  useEffect(() => {
    if (!languages || languages.length === 0) { setBackend(null); return; }
    let cancelled = false;
    ParserFactory.probe(languages[0]).then(b => {
      if (!cancelled) setBackend(b);
    }).catch(() => {
      if (!cancelled) setBackend(null);
    });
    return () => { cancelled = true; };
  }, [languages]);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const r = await api.get(`/graph/status`, { params: { workspaceId } });
      setStatus(r.data);
    } catch (e) {
      // P2: 401 (token 失效/后端重启) 时, 保留旧 status 仅追加 error 提示,
      //     避免 4 个数字区直接消失. 重试成功会自动覆盖.
      const status = e?.response?.status;
      if (status === 401) {
        setStatus(prev => prev ? { ...prev, error: '登录已过期, 请刷新页面重新登录' }
                              : { available: false, error: '未登录' });
      } else {
        setStatus(prev => prev ? { ...prev, error: e?.response?.data?.error || e.message }
                              : { available: false, error: e?.response?.data?.error || e.message });
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  // 首次挂载 + workspaceId 变化时自动拉一次
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [workspaceId]);

  // PR8: 多语言循环建库的进度聚合辅助函数.
  // langIdx: 当前语言索引 (0-based), langTotal: 语言总数, langLabel: 当前语言名
  const makeMultiLangProgress = (p, langIdx, langTotal, langLabel) => {
    const total = p.total || 0;
    const processed = p.processed || 0;
    const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
    const phase = p.phase === 'done' ? 'done' : (p.phase === 'clearing' ? 'clearing' : 'building');
    return {
      phase, totalFiles: total, processedFiles: processed, percent, currentFile: p.currentFile,
      langIdx, langTotal, langLabel,
    };
  };

  async function build() {
    if (!workspaceId || !projectRoot) { message.warning('当前会话缺少 workspaceId / projectRoot'); return; }
    if (!languages || languages.length === 0) { message.warning('未检测到支持的代码文件, 请确认项目路径'); return; }
    setBusy('build');
    setBuildProgress({ phase: 'clearing', totalFiles: 0, processedFiles: 0, percent: 0, currentFile: null, langTotal: languages.length });
    try {
      // PR8: 循环每种语言, 各自调 ParserFactory.create + parseWorkspace, ingest 到同一 workspaceId.
      let totalIngested = { files: 0, symbols: 0, callEdges: 0, refEdges: 0 };
      let lastBackend = null;
      let hasError = false;
      for (let li = 0; li < languages.length; li++) {
        const lang = languages[li];
        const langLabel = LANG_LABELS[lang] || lang;
        // 每种语言独立 ParserFactory.create (wasm + query 不同)
        const { parser, backend: be } = await ParserFactory.create(lang, projectRoot);
        lastBackend = be;
        setBackend(be);
        const onProgress = (p) => setBuildProgress(makeMultiLangProgress(p, li, languages.length, langLabel));
        try {
          // PR8: 第一种语言 clearFirst=true 清空旧图谱, 后续语言 clearFirst=false 追加.
          const r = await parser.parseWorkspace(workspaceId, projectRoot, lang, onProgress, li === 0);
          const ig = r.ingest || {};
          if (ig.success === false) {
            console.warn(`[build] ${langLabel} ingest failed:`, ig.error);
            hasError = true;
          } else {
            totalIngested.files += ig.filesIngested || 0;
            totalIngested.symbols += ig.symbolsWritten || 0;
            totalIngested.callEdges += ig.callEdgesWritten || 0;
            totalIngested.refEdges += ig.refEdgesWritten || 0;
          }
        } catch (e) {
          console.warn(`[build] ${langLabel} parseWorkspace failed:`, e.message);
          hasError = true;
        }
        try { parser.dispose(); } catch (_) {}
      }
      setBuildProgress(prev => prev ? { ...prev, phase: 'done' } : null);
      if (hasError && totalIngested.files === 0) {
        message.error('建库失败: 所有语言均未成功');
      } else {
        const beLabel = lastBackend === 'lsp' ? 'LSP' : 'tree-sitter';
        const langSummary = languages.map(l => LANG_LABELS[l] || l).join('+');
        message.success(`建库完成 [${beLabel} ${langSummary}]: 文件 ${totalIngested.files}, 符号 ${totalIngested.symbols}, 调用边 ${totalIngested.callEdges}, 引用边 ${totalIngested.refEdges}${hasError ? ' (部分语言失败)' : ''}`);
      }
      // P2: 乐观更新 status 数字 (基于本次 build 的累加), 不依赖 /api/graph/status.
      //     401/5xx 时后端实际数据可能滞后, refresh() 后续会自动覆盖.
      setStatus(prev => ({
        available: true,
        files: totalIngested.files,
        symbols: totalIngested.symbols,
        calls: totalIngested.callEdges,
        references: totalIngested.refEdges,
        lastIndexedAt: new Date().toISOString(),
        error: prev?.error, // 保留之前的 error 提示 (例: 401)
      }));
      refresh();
    } catch (e) {
      setBuildProgress(prev => prev ? { ...prev, phase: 'error' } : null);
      message.error('建库失败: ' + e.message);
    } finally {
      setBusy(null);
    }
  }

  async function syncAll() {
    if (!workspaceId || !projectRoot) { message.warning('当前会话缺少 workspaceId / projectRoot'); return; }
    if (!languages || languages.length === 0) { message.warning('未检测到支持的代码文件, 请确认项目路径'); return; }
    setBusy('syncAll');
    setBuildProgress({ phase: 'building', totalFiles: 0, processedFiles: 0, percent: 0, currentFile: null, langTotal: languages.length });
    try {
      // PR8: 循环每种语言做增量同步
      let totalRebuilt = 0;
      let totalAdded = 0, totalModified = 0, totalDeleted = 0;
      let allSkipped = true;
      let lastBackend = null;
      let hasError = false;
      for (let li = 0; li < languages.length; li++) {
        const lang = languages[li];
        const langLabel = LANG_LABELS[lang] || lang;
        const { parser, backend: be } = await ParserFactory.create(lang, projectRoot);
        lastBackend = be;
        const onProgress = (p) => setBuildProgress(makeMultiLangProgress(p, li, languages.length, langLabel));
        try {
          const r = await parser.parseIncremental(workspaceId, projectRoot, lang, onProgress);
          if (!r.skipped) {
            allSkipped = false;
            totalRebuilt += r.files || 0;
            totalAdded += r.added || 0;
            totalModified += r.modified || 0;
            totalDeleted += r.deleted || 0;
          }
        } catch (e) {
          console.warn(`[syncAll] ${langLabel} failed:`, e.message);
          hasError = true;
        }
        try { parser.dispose(); } catch (_) {}
      }
      if (allSkipped) {
        message.info(`无变更 (跨 ${languages.length} 语言)`);
      } else {
        const beLabel = lastBackend === 'lsp' ? 'LSP' : 'tree-sitter';
        message.success(`增量同步 [${beLabel}]: 重建 ${totalRebuilt} 文件 (added=${totalAdded} modified=${totalModified} deleted=${totalDeleted})${hasError ? ' (部分语言失败)' : ''}`);
      }
      refresh();
    } catch (e) {
      message.error('增量同步失败: ' + e.message);
    } finally {
      setBusy(null);
      setBuildProgress(null);
    }
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
          {isDesktop
            ? <Tag color="purple" icon={<DesktopOutlined />}>本地解析</Tag>
            : <Tag color="orange" icon={<GlobalOutlined />}>浏览器</Tag>}
          {/* PR7/PR8: 显示当前生效的 backend. LSP 已装→绿色 LSP tag, 否则→金色 tree-sitter tag.
              浏览器模式 backend 也会是 'tree-sitter' (通过本机 agent 读文件). */}
          {backend === 'lsp' && (
            <Tag color="green" icon={<ApiOutlined />}>LSP</Tag>
          )}
          {backend === 'tree-sitter' && (
            <Tag color="gold" icon={<ExperimentOutlined />}>tree-sitter</Tag>
          )}
          {/* PR8: 显示自动检测到的语言列表 (多语言 monorepo). null=检测中, []=无支持语言. */}
          {languages === null && projectRoot && (
            <Tag color="default">检测语言中…</Tag>
          )}
          {languages && languages.length > 0 && languages.map(lang => (
            <Tag key={lang} color="blue">{LANG_LABELS[lang] || lang}</Tag>
          ))}
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
            disabled={!workspaceId || !projectRoot || !languages || languages.length === 0 || busy === 'syncAll'}
          >全量建库</Button>
          <Button
            size="small" type="primary"
            icon={<SyncOutlined />}
            onClick={syncAll}
            loading={busy === 'syncAll'}
            disabled={!workspaceId || !projectRoot || !languages || languages.length === 0 || busy === 'build'}
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

        {/* PR8: 浏览器模式 + 本机 agent 未启动 → 提示用户. backend=null 说明 probe 失败. */}
        {!isDesktop && !backend && (
          <Alert
            type="warning" showIcon
            message="浏览器模式未检测到本机 agent"
            description="浏览器无法直接读取本地文件, 需要本机 agent (autobot-agent) 提供文件读取 API。请确认本机 agent 已启动并监听当前端口。后端 FalkorDB 仍可查询已建立的图谱。"
          />
        )}

        {/* P7-9: 全量建库进度条. busy != null 时渲染, phase=clearing/building/done/error. */}
        {busy != null && buildProgress && (
          <div style={{
            background: '#0a0a0a', border: '1px solid #262626', borderRadius: 8,
            padding: '12px 14px', marginBottom: 4
          }}>
            <Space size="small" style={{ marginBottom: 6 }}>
              {(buildProgress.phase === 'clearing' || buildProgress.phase === 'building') && (
                <LoadingOutlined style={{ color: '#1677ff' }} />
              )}
              {buildProgress.phase === 'clearing' && <Text strong>正在清空旧图谱…</Text>}
              {buildProgress.phase === 'building' && (
                <Text strong>
                  正在解析代码…
                  {/* PR8: 多语言循环时显示当前语言索引, 如 "Java 1/3" */}
                  {buildProgress.langTotal > 1 && buildProgress.langLabel && (
                    <Tag color="blue" style={{ marginLeft: 8, fontSize: 11 }}>
                      {buildProgress.langLabel} ({buildProgress.langIdx + 1}/{buildProgress.langTotal})
                    </Tag>
                  )}
                </Text>
              )}
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
          <Alert type="info" showIcon message={
            backend === null
              ? '尚未索引 — 请先启动本机 agent, 再选语言点 [全量建库].'
              : '尚未索引 — 选语言后点 [全量建库] 开始解析 (后端 FalkorDB 已就绪).'
          } />
        )}

        {/* PR7/PR8: tree-sitter 回退提示 — 桌面壳 LSP 未装, 或浏览器模式.
            告诉用户走的是 AST 启发式解析 (区别只在文件来源: 桌面壳 IPC vs 本机 agent HTTP). */}
        {backend === 'tree-sitter' && (
          <Alert
            type="warning" showIcon
            message={isDesktop
              ? '未检测到本机 LSP, 已自动回退到 tree-sitter AST 解析'
              : '浏览器模式: tree-sitter AST 解析 (通过本机 agent 读取文件)'}
            description={isDesktop
              ? '符号 / 调用边基于语法树启发式提取, 准确度略低于 LSP。如需精确解析, 请在 LSP 设置面板安装对应语言的 LSP server (typescript-language-server / pyright / gopls / jdtls)。'
              : '浏览器无法 spawn LSP 进程, 走纯前端 wasm AST 解析。符号 / 调用边基于语法树启发式提取, 对快速建库足够。'}
          />
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
