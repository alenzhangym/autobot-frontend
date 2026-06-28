import { useState, useCallback, useMemo } from 'react';
import {
  Card, Tag, Button, Space, Typography, Input, Tree, Table, Empty, Spin, Alert, message, Tabs, Tooltip
} from 'antd';
import {
  SearchOutlined, ApartmentOutlined, ShareAltOutlined, FileTextOutlined,
  ArrowRightOutlined, ArrowLeftOutlined, NodeIndexOutlined
} from '@ant-design/icons';
import api from '../auth';

const { Text, Paragraph } = Typography;

/**
 * P7-6: 代码图可视化探索器.
 * 三段式: ① 模糊搜符号 ② 选中符号看调用链 (incoming/outgoing tree)
 *        ③ 切 Tab 看引用列表. 全部基于 antd, 无需 ECharts 等额外依赖.
 *
 * @param {string} workspaceId
 */
export default function CodeGraphExplorer({ workspaceId = '' }) {
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null); // {path, key, name}
  const [chain, setChain] = useState(null);
  const [chainLoading, setChainLoading] = useState(false);
  const [refs, setRefs] = useState([]);
  const [refsLoading, setRefsLoading] = useState(false);

  const runSearch = useCallback(async () => {
    if (!workspaceId) { message.warning('workspaceId 为空'); return; }
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const r = await api.get('/graph/symbols/search', { params: { workspaceId, q, limit: 20 } });
      setResults(r.data || []);
    } catch (e) {
      message.error('搜索失败: ' + (e?.response?.data?.error || e.message));
    } finally { setSearching(false); }
  }, [workspaceId, q]);

  async function pickSymbol(s) {
    setSelected(s);
    setChain(null);
    setRefs([]);
    setChainLoading(true);
    setRefsLoading(true);
    try {
      const r = await api.get('/graph/callchain', {
        params: { workspaceId, path: s.path, key: s.key, depth: 1, maxNeighbors: 30 }
      });
      setChain(r.data);
    } catch (e) {
      message.error('调用链查询失败: ' + (e?.response?.data?.error || e.message));
    } finally { setChainLoading(false); }
    try {
      const r = await api.get('/graph/references', {
        params: { workspaceId, path: s.path, key: s.key, limit: 50 }
      });
      setRefs(r.data || []);
    } catch (e) {
      message.error('引用查询失败: ' + (e?.response?.data?.error || e.message));
    } finally { setRefsLoading(false); }
  }

  // 把 incoming + seed + outgoing 组装成 antd Tree 数据 (incoming 在左, outgoing 在右)
  const treeData = useMemo(() => {
    if (!chain?.seed) return [];
    const seed = chain.seed;
    const incoming = chain.incoming || [];
    const outgoing = chain.outgoing || [];
    return [{
      key: 'seed',
      title: <Space><Tag color="blue">{seed.kind || 'Symbol'}</Tag><Text strong>{seed.name}</Text><Text type="secondary" style={{ fontSize: 11 }}>{shortPath(seed.path)}</Text></Space>,
      children: [
        {
          key: 'incoming',
          title: <Space><ArrowLeftOutlined /><Text type="secondary">调用方 ({incoming.length})</Text></Space>,
          selectable: false,
          children: incoming.map((n, i) => ({
            key: `in-${i}`,
            title: <SymbolNode node={n} onClick={() => pickSymbol(n)} />,
            isLeaf: true,
          })),
        },
        {
          key: 'outgoing',
          title: <Space><ArrowRightOutlined /><Text type="secondary">被调用 ({outgoing.length})</Text></Space>,
          selectable: false,
          children: outgoing.map((n, i) => ({
            key: `out-${i}`,
            title: <SymbolNode node={n} onClick={() => pickSymbol(n)} />,
            isLeaf: true,
          })),
        },
      ],
    }];
  }, [chain]);

  const refColumns = [
    {
      title: '引用方', dataIndex: 'name', key: 'name',
      render: (v, r) => (
        <Button type="link" size="small" style={{ padding: 0 }} onClick={() => pickSymbol(r)}>
          <Tag color="cyan">{r.kind || '?'}</Tag> <Text strong>{v}</Text>
        </Button>
      )
    },
    { title: '所在文件', dataIndex: 'path', key: 'path', ellipsis: true, render: shortPath },
    { title: '类/容器', dataIndex: 'enclosingClass', key: 'enclosingClass', width: 160, render: (v) => v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text> },
    { title: '行', dataIndex: 'line', key: 'line', width: 60 },
  ];

  return (
    <Card
      size="small"
      title={<Space><NodeIndexOutlined /><span>代码图探索</span>{!workspaceId && <Tag color="red">缺 workspaceId</Tag>}</Space>}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {/* ① 搜索框 */}
        <Input.Search
          placeholder="搜索符号名 (类/方法), 如 build / UserService"
          enterButton={<><SearchOutlined /> 搜索</>}
          value={q}
          onChange={e => setQ(e.target.value)}
          onSearch={runSearch}
          loading={searching}
        />

        {results.length > 0 && (
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>匹配 {results.length} 个符号 — 点选查看调用链</Text>
            <Space wrap size="small" style={{ marginTop: 4 }}>
              {results.map((s, i) => (
                <Button
                  key={`${s.path}-${s.key}-${i}`}
                  size="small"
                  type={selected?.key === s.key && selected?.path === s.path ? 'primary' : 'default'}
                  onClick={() => pickSymbol(s)}
                >
                  <Tag color="blue">{s.kind || '?'}</Tag> {s.name}
                  <Text type="secondary" style={{ fontSize: 10 }}> {shortPath(s.path)}</Text>
                </Button>
              ))}
            </Space>
          </div>
        )}

        {results.length === 0 && q && !searching && (
          <Empty description="无匹配符号 — 先到上方点 [增量同步] / [全量建库] 索引本会话工作区" />
        )}

        {/* ② 调用链 + ③ 引用 */}
        {selected && (
          <Tabs
            size="small"
            items={[
              {
                key: 'chain',
                label: <Space><ApartmentOutlined /> 调用链</Space>,
                children: (
                  <Spin spinning={chainLoading}>
                    {!chain?.available && <Alert type="warning" showIcon message="FalkorDB 未连接" />}
                    {chain?.available && !chain?.seed && <Empty description="未在图中找到该符号 (可能未索引)" />}
                    {chain?.seed && (
                      <Tree
                        showLine
                        defaultExpandAll
                        treeData={treeData}
                      />
                    )}
                  </Spin>
                )
              },
              {
                key: 'refs',
                label: <Space><ShareAltOutlined /> 引用 ({refs.length})</Space>,
                children: (
                  <Spin spinning={refsLoading}>
                    <Table
                      size="small"
                      rowKey={(r, i) => `${r.path}-${r.key}-${i}`}
                      columns={refColumns}
                      dataSource={refs}
                      pagination={false}
                      locale={{ emptyText: <Empty description="无引用 (REFERENCES 边)" /> }}
                    />
                  </Spin>
                )
              }
            ]}
          />
        )}

        {!selected && (
          <Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
            <FileTextOutlined /> 选中一个符号后, 此处显示其调用链 (谁调用我 / 我调用谁) 和引用列表.
          </Paragraph>
        )}
      </Space>
    </Card>
  );
}

function SymbolNode({ node, onClick }) {
  return (
    <Button type="link" size="small" style={{ padding: 0, textAlign: 'left' }} onClick={onClick}>
      <Tag color="cyan">{node.kind || '?'}</Tag> <Text>{node.name}</Text>
      <Text type="secondary" style={{ fontSize: 10 }}> {shortPath(node.path)}</Text>
    </Button>
  );
}

function shortPath(p) {
  if (!p) return '';
  const parts = String(p).replace(/\\/g, '/').split('/');
  if (parts.length <= 3) return p;
  return '.../' + parts.slice(-2).join('/');
}
