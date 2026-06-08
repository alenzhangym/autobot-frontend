import React from 'react'
import { Modal, Form, Input, Select, TimePicker, message } from 'antd'
import dayjs from 'dayjs'
import api from './auth'

export default function ScheduleModal({ visible, onCancel, plan, steps, onConfirm }) {
  const [scheduleForm] = Form.useForm()

  // When visible changes to true, reset the form and set initial values
  React.useEffect(() => {
    if (visible && plan) {
      const rawGoal = plan.userGoal || plan.title || 'Scheduled Task';
      const truncatedGoal = rawGoal.length > 50 ? rawGoal.substring(0, 50) + "..." : rawGoal;
      scheduleForm.setFieldsValue({ 
        taskGoal: truncatedGoal,
        scheduleType: 'daily',
        scheduleTime: dayjs('10:00', 'HH:mm')
      });
    }
  }, [visible, plan, scheduleForm])

  const handleAddSchedule = async (values) => {
    try {
      const payload = {
        taskGoal: values.taskGoal,
        planJson: JSON.stringify(steps),
        scheduleType: values.scheduleType,
        scheduleTime: values.scheduleTime.format('HH:mm')
      }
      await api.post('/scheduled-tasks', payload)
      message.success('Task scheduled successfully!')
      scheduleForm.resetFields()
      
      // Notify parent to refresh tasks if needed
      window.dispatchEvent(new CustomEvent('scheduledTaskAdded'));
      if (typeof onConfirm === 'function') {
         onConfirm()
      }
      onCancel()
    } catch (error) {
      message.error('Failed to schedule task: ' + (error.response?.data || error.message))
    }
  }

  return (
    <Modal
      title="Add to Scheduled Tasks"
      open={visible}
      onCancel={() => {
        scheduleForm.resetFields()
        onCancel()
      }}
      onOk={() => scheduleForm.submit()}
      okText="Schedule"
    >
      <Form form={scheduleForm} layout="vertical" onFinish={handleAddSchedule}>
        <Form.Item
          name="taskGoal"
          label="Task Name"
          rules={[{ required: true, message: 'Please enter a task name' }]}
        >
          <Input placeholder="Enter task name" maxLength={100} />
        </Form.Item>
        <Form.Item
          name="scheduleType"
          label="Schedule Frequency"
          initialValue="daily"
          rules={[{ required: true, message: 'Please select frequency' }]}
        >
          <Select>
            <Select.Option value="daily">Daily</Select.Option>
            <Select.Option value="weekly">Weekly</Select.Option>
            <Select.Option value="monthly">Monthly</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item
          name="scheduleTime"
          label="Execution Time"
          initialValue={dayjs('10:00', 'HH:mm')}
          rules={[{ required: true, message: 'Please select time' }]}
        >
          <TimePicker format="HH:mm" style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  )
}