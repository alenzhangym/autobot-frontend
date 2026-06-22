import React, { useMemo, useState, useEffect } from 'react';
import {
  Tooltip,
  Tag,
  Typography,
  Space,
  Button,
} from 'antd';
import {
  CheckCircleFilled,
  LoadingOutlined,
  CloseCircleFilled,
  QuestionCircleOutlined,
  RightOutlined,
  DownOutlined,
  SearchOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  CodeOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import './ReActStepper.css';

const { Text } = Typography;

/**
 * ReAct 进度步骤条
 *
 * <p>把后端推送的 REACT_TOOL_CALL 事件序列化为"带连接线的步骤条"。
 *
 * <p>Props:
 * <ul>
 *   <li>events: Array<{ tool, mappedAgent, status, iteration, input }> - 后端事件</li>
 *   <li>isActive: boolean - 是否仍在执行中（最后一节点旋转）</li>
 * </ul>
 */
export default function ReActStepper({ events, isActive }) {
  const [collapsed, setCollapsed] = useState(false);

  // 去重 + 排序：同 iter+tool 的 CALLING/OK/FAILED 只保留最终状态
  const steps = useMemo(() => {
    if (!events || events.length === 0) return [];
    const map = new Map();
    for (const e of events) {
      const key = `${e.iteration}-${e.tool}`;
      const prev = map.get(key);
      // 优先级: FAILED > OK > CALLING > UNKNOWN_TOOL
      const priority = (s) =>
        s === 'FAILED' ? 3 : s === 'OK' ? 2 : s === 'CALLING' ? 1 : 0;
      if (!prev || priority(e.status) >= priority(prev.status)) {
        map.set(key, e);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.iteration - b.iteration);
  }, [events]);

  // 第一次收到事件时自动展开
  useEffect(() => {
    if (events && events.length > 0) setCollapsed(false);
  }, [events && events.length]);

  if (!steps || steps.length === 0) return null;

  const completed = steps.filter(s => s.status === 'OK').length;
  const failed = steps.filter(s => s.status === 'FAILED').length;
  const total = steps.length;
  const lastStep = steps[steps.length - 1];
  const isRunning = isActive || (lastStep && lastStep.status === 'CALLING');

  return (
    <div className={`react-stepper ${isRunning ? 'react-stepper--running' : ''}`}>
      {/* Header */}
      <div
        className="react-stepper__header"
        onClick={() => setCollapsed(c => !c)}
      >
        <Space size={8}>
          {isRunning
            ? <LoadingOutlined spin style={{ color: '#1677ff' }} />
            : <CheckCircleFilled style={{ color: '#52c41a' }} />
          }
          <Text strong style={{ fontSize: 13 }}>
            {isRunning ? 'ReAct 正在推理' : 'ReAct 推理完成'}
          </Text>
          <Tag color={failed > 0 ? 'red' : 'blue'} style={{ marginLeft: 4 }}>
            {completed}/{total} 步
          </Tag>
          {failed > 0 && <Tag color="red">{failed} 失败</Tag>}
        </Space>
        <Button
          type="text"
          size="small"
          icon={collapsed ? <RightOutlined /> : <DownOutlined />}
          style={{ marginLeft: 'auto' }}
        />
      </div>

      {!collapsed && (
        <div className="react-stepper__body">
          {steps.map((s, idx) => {
            const isLast = idx === steps.length - 1;
            const node = renderNode(s);
            return (
              <div key={`${s.iteration}-${s.tool}-${idx}`} className="react-stepper__row">
                {/* 左侧：节点 + 连接线 */}
                <div className="react-stepper__rail">
                  <div className="react-stepper__dot">{node.icon}</div>
                  {!isLast && <div className={`react-stepper__line react-stepper__line--${s.status}`} />}
                </div>
                {/* 右侧：步骤内容 */}
                <div className="react-stepper__content">
                  <div className="react-stepper__title">
                    <Space size={6}>
                      <Text type="secondary" style={{ fontSize: 12 }}>#{s.iteration + 1}</Text>
                      <Text strong style={{ fontSize: 13 }}>{s.tool}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>→</Text>
                      <Text style={{ fontSize: 12, color: '#1677ff' }}>{s.mappedAgent}</Text>
                      <Tag
                        color={node.tagColor}
                        style={{ marginLeft: 4, fontSize: 11, padding: '0 6px' }}
                      >
                        {node.statusText}
                      </Tag>
                    </Space>
                  </div>
                  {s.input && (
                    <Tooltip title={s.input} placement="topLeft">
                      <div className="react-stepper__input">
                        {s.input.length > 100 ? s.input.substring(0, 100) + '…' : s.input}
                      </div>
                    </Tooltip>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function renderNode(s) {
  const tool = (s.tool || '').toLowerCase();
  let icon = <QuestionCircleOutlined />;
  if (tool.includes('rag') || tool.includes('vector') || tool.includes('search')) {
    icon = <SearchOutlined />;
  } else if (tool.includes('db') || tool.includes('sql')) {
    icon = <DatabaseOutlined />;
  } else if (tool.includes('code')) {
    icon = <CodeOutlined />;
  } else if (tool.includes('doc')) {
    icon = <FileTextOutlined />;
  } else if (tool.includes('summarize') || tool.includes('llm')) {
    icon = <ThunderboltOutlined />;
  }

  if (s.status === 'CALLING') {
    return {
      icon: <LoadingOutlined spin />,
      tagColor: 'processing',
      statusText: '执行中',
    };
  }
  if (s.status === 'OK') {
    return { icon: <CheckCircleFilled />, tagColor: 'success', statusText: '完成' };
  }
  if (s.status === 'FAILED') {
    return { icon: <CloseCircleFilled />, tagColor: 'error', statusText: '失败' };
  }
  return { icon, tagColor: 'default', statusText: s.status };
}
