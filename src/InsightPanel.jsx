import React, { useMemo } from 'react';
import { Card, Typography, Empty, theme } from 'antd';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer
} from 'recharts';
import { BulbOutlined } from '@ant-design/icons';
import { motion } from 'framer-motion';

const { Text } = Typography;

const COLORS = ['#1677ff', '#52c41a', '#faad14', '#fa8c16', '#f5222d', '#eb2f96', '#722ed1', '#2f54eb', '#13c2c2', '#1890ff'];

export default function InsightPanel({ resultStr }) {
  const { token } = theme.useToken();

  const { data, features } = useMemo(() => {
    try {
      const parsed = JSON.parse(resultStr);
      if (parsed && Array.isArray(parsed.data) && parsed.features) {
        return { data: parsed.data, features: parsed.features };
      }
    } catch (e) {
      // Not a JSON or not matching our structure
    }
    return { data: null, features: null };
  }, [resultStr]);

  if (!data || !features || data.length === 0) return null;

  // Render a specific chart based on extracted features
  const renderChart = () => {
    // 1. Trend (Line Chart)
    if (features.trend && features.trend.xAxis && features.trend.yAxis) {
      return (
        <div style={{ width: '100%', height: 250 }}>
          <Text strong style={{ display: 'block', textAlign: 'center', marginBottom: 12 }}>Trend Analysis</Text>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={token.colorBorder} />
              <XAxis dataKey={features.trend.xAxis} stroke={token.colorTextSecondary} tick={{ fontSize: 12 }} />
              <YAxis stroke={token.colorTextSecondary} tick={{ fontSize: 12 }} />
              <RechartsTooltip contentStyle={{ backgroundColor: token.colorBgElevated, borderColor: token.colorBorder, color: token.colorText }} />
              <Legend />
              <Line type="monotone" dataKey={features.trend.yAxis} stroke={COLORS[0]} activeDot={{ r: 8 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      );
    }

    // 2. Distribution (Pie Chart or Bar Chart)
    if (features.distribution && features.distribution.category && features.distribution.value) {
      const isManyCategories = data.length > 6;
      return (
        <div style={{ width: '100%', height: 250 }}>
          <Text strong style={{ display: 'block', textAlign: 'center', marginBottom: 12 }}>Distribution Analysis</Text>
          <ResponsiveContainer width="100%" height="100%">
            {isManyCategories ? (
              <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={token.colorBorder} />
                <XAxis dataKey={features.distribution.category} stroke={token.colorTextSecondary} tick={{ fontSize: 12 }} />
                <YAxis stroke={token.colorTextSecondary} tick={{ fontSize: 12 }} />
                <RechartsTooltip contentStyle={{ backgroundColor: token.colorBgElevated, borderColor: token.colorBorder, color: token.colorText }} />
                <Legend />
                <Bar dataKey={features.distribution.value} fill={COLORS[1]} radius={[4, 4, 0, 0]} />
              </BarChart>
            ) : (
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey={features.distribution.value}
                  nameKey={features.distribution.category}
                >
                  {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip contentStyle={{ backgroundColor: token.colorBgElevated, borderColor: token.colorBorder, color: token.colorText }} />
                <Legend />
              </PieChart>
            )}
          </ResponsiveContainer>
        </div>
      );
    }

    // 3. Correlation (Bar Chart)
    if (features.correlation && features.correlation.xAxis && features.correlation.yAxis) {
      return (
        <div style={{ width: '100%', height: 250 }}>
          <Text strong style={{ display: 'block', textAlign: 'center', marginBottom: 12 }}>Correlation Analysis</Text>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={token.colorBorder} />
              <XAxis dataKey={features.correlation.xAxis} stroke={token.colorTextSecondary} tick={{ fontSize: 12 }} />
              <YAxis stroke={token.colorTextSecondary} tick={{ fontSize: 12 }} />
              <RechartsTooltip contentStyle={{ backgroundColor: token.colorBgElevated, borderColor: token.colorBorder, color: token.colorText }} />
              <Legend />
              <Bar dataKey={features.correlation.yAxis} fill={COLORS[2]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      );
    }

    return null;
  };

  const chart = renderChart();

  if (!chart) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}>
      <Card 
        size="small" 
        title={<><BulbOutlined style={{ color: token.colorWarning, marginRight: 8 }} />Data Insight</>}
        style={{ marginTop: 12, borderColor: token.colorBorderSecondary, boxShadow: token.boxShadowTertiary }}
        styles={{ header: { borderBottom: `1px solid ${token.colorBorderSecondary}` } }}
      >
        {chart}
      </Card>
    </motion.div>
  );
}
