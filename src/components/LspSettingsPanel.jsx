import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Card, Tag, Button, Space, Typography, Table, Alert, Spin, message, Tooltip, Progress
} from 'antd';
import {
  ReloadOutlined, DownloadOutlined, CheckCircleOutlined, CloseCircleOutlined,
  ToolOutlined, DesktopOutlined, GlobalOutlined
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

/**
 * 内置 LSP server 注册表 (前端本地知识, 不再问后端).
 * binary: 命令名 (用于 which 探测 + npm install -g 包名)
 * lang:   语言标签
 * via:    安装方式 (npm/pip/go/github)
 */
const LSP_SERVERS = [
  { binary: 'typescript-language-server', lang: 'TypeScript/JS', via: 'npm' },
  { binary: 'vscode-json-language-server', lang: 'JSON', via: 'npm' },
  { binary: 'vscode-css-language-server', lang: 'CSS', via: 'npm' },
  { binary: 'pyright', lang: 'Python', via: 'npm' },
  { binary: 'gopls', lang: 'Go', via: 'go' },
  // GitHub Releases via — 桌面壳 installGithubRelease() 自动选本平台 asset + 解压 + 软链到 PATH
  { binary: 'rust-analyzer', lang: 'Rust', via: 'github', repo: 'rust-lang/rust-analyzer' },
  { binary: 'clangd', lang: 'C/C++', via: 'github', repo: 'clangd/clangd' },
  // P7-8: jdtls 走 download.eclipse.org/jdtls/snapshots (50MB tar.gz, OSGi 启动器, 需 JDK 21+).
  // 后端独立处理 — 浏览器模式调 /lsp/install, 桌面壳暂不支持 (需 Java 探测 + shim 写盘)
  { binary: 'jdtls', lang: 'Java', via: 'eclipse' },
  { binary: 'lua-language-server', lang: 'Lua', via: 'github', repo: 'LuaLS/lua-language-server' },
  { binary: 'bash-language-server', lang: 'Bash', via: 'npm' },
  { binary: 'yaml-language-server', lang: 'YAML', via: 'npm' },
  { binary: 'dockerfile-language-server-nodejs', lang: 'Dockerfile', via: 'npm' },
  { binary: 'vim-language-server', lang: 'Vim', via: 'npm' },
  { binary: 'kotlin-language-server', lang: 'Kotlin', via: 'github', repo: 'fwcd/kotlin-language-server' },
  { binary: 'smithy-language-server', lang: 'Smithy', via: 'npm' },
  { binary: 'cmake-language-server', lang: 'CMake', via: 'pip' },
  { binary: 'marksman', lang: 'Markdown', via: 'github', repo: 'artempyanykh/marksman' },
  { binary: 'terraform-ls', lang: 'Terraform', via: 'github', repo: 'hashicorp/terraform-ls' },
  { binary: 'sql-formatter', lang: 'SQL', via: 'npm' },
  { binary: 'graphql-language-service-cli', lang: 'GraphQL', via: 'npm' },
  // elixir-ls binary 在 https://elixir-ls.github.io/elixir-ls/ 提供, GitHub Release 是 source
  { binary: 'elixir-ls', lang: 'Elixir', via: 'github', repo: null },
  // phpactor 是 phar, 走 composer global require — 需手工装
  { binary: 'phpactor', lang: 'PHP', via: 'github', repo: null },
  { binary: 'ruby-lsp', lang: 'Ruby', via: 'gem' },
  { binary: 'ocamllsp', lang: 'OCaml', via: 'opam' },
  { binary: 'nimlsp', lang: 'Nim', via: 'nimble' },
  { binary: 'vue-language-server', lang: 'Vue', via: 'npm' },
  { binary: 'svelte-language-server', lang: 'Svelte', via: 'npm' },
  { binary: 'tailwindcss-language-server', lang: 'Tailwind', via: 'npm' },
  { binary: 'html-language-server', lang: 'HTML', via: 'npm' },
  { binary: 'r-lsp', lang: 'R', via: 'pip' },
  // haskell-language-server 需 GHC 工具链 (ghcup), 走 GitHub Release 只能下源码
  { binary: 'haskell-language-server', lang: 'Haskell', via: 'github', repo: null },
  { binary: 'perl-languageserver', lang: 'Perl', via: 'pip' },
];

/** 把 binary → 实际安装命令 (cmd, args). */
function installCommandFor(srv) {
  switch (srv.via) {
    case 'npm': return { cmd: 'npm', args: ['install', '-g', srv.binary] };
    case 'pip': return { cmd: 'pip', args: ['install', srv.binary] };
    case 'go':  return { cmd: 'go', args: ['install', `golang.org/x/tools/gopls@latest`] };
    case 'gem': return { cmd: 'gem', args: ['install', srv.binary] };
    case 'github':
      // 桌面壳 installGithubRelease; 浏览器模式无此能力
      return srv.repo ? { kind: 'github', repo: srv.repo, binary: srv.binary } : null;
    // P7-8: jdtls 走 Eclipse download.eclipse.org — 必须后端下载 + 写 shim, 桌面壳暂不支持
    case 'eclipse': return { kind: 'eclipse' };
    default: return null; // opam/nimble 等需用户手工装
  }
}

/**
 * LSP 语言服务器安装面板.
 *
 * 桌面壳模式 (window.autobotDesktop.isDesktop === true):
 *   - 用 autobotDesktop.which() 探测本地 PATH
 *   - 用 autobotDesktop.spawn() 在客户端本地直接 npm install -g
 *   - 完全不依赖后端 — 每个客户端配置自身的 LSP 服务
 *
 * 浏览器模式:
 *   - 调后端 /lsp/servers + /lsp/install (服务端安装)
 */
export default function LspSettingsPanel() {
  const isDesktop = typeof window !== 'undefined' && window.autobotDesktop?.isDesktop === true;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(null); // binary name
  const [installLog, setInstallLog] = useState(null); // {binary, lines, pct}
  const childRef = useRef(null);

  // ── 桌面壳: 用 which 探测本地 ──────────────────────────────────────────
  const refreshDesktop = useCallback(async () => {
    setLoading(true);
    try {
      const checked = await Promise.all(
        LSP_SERVERS.map(async (srv) => {
          const r = await window.autobotDesktop.which(srv.binary);
          return { ...srv, installed: r.found, path: r.path };
        })
      );
      setRows(checked);
    } catch (e) {
      message.error('本地探测失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── 浏览器: 后端 LSP 端点已删除 (PR2 彻底前端化) — 仅显示提示 ────────
  const refreshServer = useCallback(async () => {
    // 浏览器模式: 无法本地探测, 也不再有后端 /lsp/servers 端点
    setRows(LSP_SERVERS.map(srv => ({ ...srv, installed: false, path: null })));
  }, []);

  const refresh = isDesktop ? refreshDesktop : refreshServer;
  useEffect(() => { refresh(); }, [refresh]);

  // ── 桌面壳: 本地 spawn 安装 ────────────────────────────────────────────
  async function installDesktop(srv) {
    const cmdInfo = installCommandFor(srv);
    if (!cmdInfo) {
      message.warning(`${srv.binary} (${srv.via}) 需手工安装 — 请参考项目文档`);
      return;
    }
    // P7-9: jdtls 走 Eclipse 站点 + 需 JDK 21+ + 写 shim —
    // 后端 LSP 端点已删 (彻底前端化), 桌面壳暂未实现 jdtls 自动安装, 提示手工装
    if (cmdInfo.kind === 'eclipse') {
      message.warning('jdtls 暂未支持桌面壳自动安装 — 需 JDK 21+, 请按 Eclipse JDTLS 官方文档手工装到 PATH');
      return;
    }
    // GitHub Releases via — 走桌面壳 installGithubRelease
    if (cmdInfo.kind === 'github') {
      if (!window.autobotDesktop?.installGithubRelease) {
        message.error('当前桌面壳版本不支持 GitHub 自动安装, 请升级桌面壳');
        return;
      }
      setInstalling(srv.binary);
      setInstallLog({ binary: srv.binary, lines: [`fetching ${cmdInfo.repo} latest release...`], pct: 5 });
      try {
        const r = await window.autobotDesktop.installGithubRelease(cmdInfo.repo, cmdInfo.binary);
        if (r.installed) {
          setInstallLog({ binary: srv.binary, lines: [r.message, `path: ${r.path}`], pct: 100 });
          message.success(`${srv.binary} ${r.version || ''} 安装完成`);
        } else {
          setInstallLog({ binary: srv.binary, lines: [r.message], pct: 0 });
          message.warning(`${srv.binary}: ${r.message}`);
        }
        refresh();
      } catch (e) {
        setInstallLog(prev => prev ? { ...prev, pct: 0, lines: [...prev.lines, `[ERROR] ${e.message}`] } : null);
        message.error(`${srv.binary} 安装失败: ${e.message}`);
      } finally {
        setInstalling(null);
      }
      return;
    }
    setInstalling(srv.binary);
    setInstallLog({ binary: srv.binary, lines: [], pct: 0 });
    try {
      const child = window.autobotDesktop.spawn(cmdInfo.cmd, cmdInfo.args, {
        shell: navigator.userAgent.includes('Windows') // Windows 上 npm/pip 需 shell
      });
      childRef.current = child;
      const lines = [];
      const onLine = (data) => {
        const arr = data.split(/\r?\n/).filter(Boolean);
        lines.push(...arr);
        setInstallLog({ binary: srv.binary, lines: [...lines], pct: Math.min(95, 10 + lines.length * 3) });
      };
      child.onStdout(onLine);
      child.onStderr(onLine);
      await new Promise((resolve, reject) => {
        child.onExit((code) => {
          if (code === 0) resolve();
          else reject(new Error(`exit ${code}`));
        });
      });
      setInstallLog({ binary: srv.binary, lines: [...lines], pct: 100 });
      message.success(`${srv.binary} 安装完成`);
      refresh();
    } catch (e) {
      message.error(`${srv.binary} 安装失败: ${e.message}`);
      setInstallLog(prev => prev ? { ...prev, pct: 0, lines: [...prev.lines, `[ERROR] ${e.message}`] } : null);
    } finally {
      setInstalling(null);
      childRef.current = null;
    }
  }

  // ── 浏览器: 后端 LSP 端点已删, 仅提示 ─────────────────────────────
  async function installServer(srv) {
    message.warning(`浏览器模式无法安装 ${srv.binary} — 请下载桌面客户端`);
  }

  const installOne = isDesktop ? installDesktop : installServer;
  const installedCount = rows.filter(r => r.installed).length;

  const columns = [
    {
      title: '语言',
      dataIndex: 'lang',
      key: 'lang',
      width: 110,
      render: (v) => <Tag style={{ fontSize: 11 }}>{v}</Tag>
    },
    {
      title: 'LSP 服务',
      dataIndex: 'binary',
      key: 'binary',
      render: (v, r) => (
        <Space direction="vertical" size={0}>
          <Text code style={{ fontSize: 12 }}>{v}</Text>
          {r.path && <Text type="secondary" style={{ fontSize: 10 }}>{r.path}</Text>}
        </Space>
      )
    },
    {
      title: '方式',
      dataIndex: 'via',
      key: 'via',
      width: 70,
      render: (v) => v ? <Tag color="blue">{v}</Tag> : <Text type="secondary">—</Text>
    },
    {
      title: '状态',
      dataIndex: 'installed',
      key: 'installed',
      width: 100,
      render: (v) => v
        ? <Tag color="green" icon={<CheckCircleOutlined />}>已就绪</Tag>
        : <Tag color="red" icon={<CloseCircleOutlined />}>未安装</Tag>
    },
    {
      title: '操作',
      key: 'action',
      width: 110,
      render: (_, row) => {
        const cmdInfo = installCommandFor(row);
        // P7-9: 浏览器模式禁用所有安装按钮 — 后端 LSP 端点已删, 仅桌面壳支持
        const disabled = !isDesktop || row.installed || !cmdInfo;
        const tip = !isDesktop
          ? '浏览器模式不支持本地安装 — 请下载桌面客户端'
          : row.installed
            ? '已就绪'
            : cmdInfo
              ? (cmdInfo.kind === 'github' ? `从 GitHub Releases 装 ${row.binary}`
                : cmdInfo.kind === 'eclipse' ? `桌面壳暂未支持 jdtls 自动安装 (需 JDK 21+, 请手工装)`
                : `运行: ${cmdInfo.cmd} ${cmdInfo.args.join(' ')}`)
              : (row.repo === null
                  ? `${row.binary} (${row.via}) 暂未支持自动安装 — 请按官方文档手工装 (见项目 README)`
                  : '无安装命令');
        return (
          <Tooltip title={tip}>
            <Button
              size="small"
              type={row.installed ? 'default' : 'primary'}
              icon={<DownloadOutlined />}
              disabled={disabled}
              loading={installing === row.binary}
              onClick={() => installOne(row)}
            >
              {row.installed ? '已就绪' : '安装'}
            </Button>
          </Tooltip>
        );
      }
    }
  ];

  return (
    <Card
      size="small"
      title={
        <Space>
          <ToolOutlined />
          <span>LSP 语言服务器</span>
          {isDesktop
            ? <Tooltip title="桌面壳模式: 在客户端本地探测与安装, 不走后端"><Tag color="purple" icon={<DesktopOutlined />}>本地</Tag></Tooltip>
            : <Tooltip title="浏览器模式: 无法本地安装 LSP"><Tag color="orange" icon={<GlobalOutlined />}>浏览器</Tag></Tooltip>}
        </Space>
      }
      extra={
        <Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {rows.length > 0 ? `${installedCount}/${rows.length} 已就绪` : ''}
          </Text>
          <Button size="small" icon={<ReloadOutlined />} onClick={refresh} loading={loading}>刷新</Button>
        </Space>
      }
    >
      <Paragraph type="secondary" style={{ fontSize: 12, margin: '0 0 12px' }}>
        {isDesktop
          ? '桌面壳模式: 每个客户端独立配置本地 LSP 服务, 安装命令在本机直接执行 (npm/pip/go). GitHub 类 server 走 Releases 自动装.'
          : '浏览器模式: 浏览器沙箱无法 spawn 进程, 也不再有后端 LSP 安装端点. 请下载桌面客户端配置本地 LSP.'}
      </Paragraph>

      {/* P7-9: 浏览器模式提示 */}
      {!isDesktop && (
        <Alert
          type="warning" showIcon
          style={{ marginBottom: 12 }}
          message="浏览器模式不支持 LSP 安装"
          description="代码图解析与 LSP 安装均需桌面客户端. 请下载并启动 autobot-desktop 后再使用此功能."
        />
      )}

      {installLog && (
        <Alert
          type={installLog.pct === 100 ? 'success' : 'info'}
          showIcon
          style={{ marginBottom: 12 }}
          message={
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Space>
                <Text strong>{installLog.binary}</Text>
                <Text type="secondary">{installLog.pct === 100 ? '完成' : '安装中...'}</Text>
              </Space>
              <Progress percent={installLog.pct} size="small" status={installLog.pct === 100 ? 'success' : 'active'} />
              {installLog.lines.length > 0 && (
                <pre style={{ maxHeight: 120, overflow: 'auto', background: '#0a0a0a', color: '#9cdcfe', padding: 8, fontSize: 11, margin: 0, borderRadius: 4 }}>
                  {installLog.lines.slice(-10).join('\n')}
                </pre>
              )}
            </Space>
          }
        />
      )}

      <Spin spinning={loading}>
        <Table
          size="small"
          rowKey="binary"
          columns={columns}
          dataSource={rows}
          pagination={false}
        />
      </Spin>
    </Card>
  );
}
