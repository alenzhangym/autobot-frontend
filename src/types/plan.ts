export interface Document {
  id: string;
  filename: string;
  fileType?: string;
  uploadDate?: string;
  size?: number;
}

export interface AgentStep {
  step?: number;
  goal?: string;
  description?: string;
  agent?: string;
  skill?: string;
  args?: Record<string, any> | string;
  step_context?: string;
  output_file?: string;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'wait' | 'process' | 'finish' | 'error';
  result?: string;
  thought?: string;
  /** S3: 后端 SubagentSpec.color（N-7）—— 优先于前端 AGENT_COLORS_FALLBACK */
  color?: string;
}

export interface PlanData {
  steps?: AgentStep[];
  used_documents?: Document[];
  plan?: AgentStep[]; // Sometimes passed as plan.plan
}

export interface PlanProps {
  plan?: PlanData | string | null;
  editable?: boolean;
  onConfirm?: (plan: AgentStep[]) => void;
}