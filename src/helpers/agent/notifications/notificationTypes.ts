export type DeliveryChannel = 'slack' | 'email';

export interface NotificationTypeSetting {
  enabled: boolean;
  channel: DeliveryChannel;
}

export interface NotificationConfig {
  senderEmail?: string;
  teamEmails?: string;
  actionFollowupDaysAfterSprintStart?: number;
  preRetroPreview: NotificationTypeSetting;
  ownerReminder: NotificationTypeSetting;
  postRetroSummary: NotificationTypeSetting;
  actionFollowup: NotificationTypeSetting;
  insightShare: NotificationTypeSetting;
}

export type TriggerKey =
  | 'preRetroPreview'
  | 'ownerReminder'
  | 'postRetroSummary'
  | 'actionFollowup'
  | 'insightShare';

export interface NotificationDispatchContext {
  projectId: string;
  slackChannelId?: string;
  projectIdCode?: string;
  topics?: Array<{ title: string; rationale?: string; state?: string }>;
  actionItems?: Array<{ title: string; owner: string; status?: string }>;
  proposals?: Array<{ title: string; owner: string; description?: string }>;
  insights?: Array<{ title: string; description: string; insight_type?: string }>;
  sprintName?: string;
  retroTitle?: string;
  summaryText?: string;
  channel?: DeliveryChannel;
}

export interface DispatchResult {
  success: boolean;
  triggerKey: TriggerKey;
  recipientName: string;
  content: string;
  status: 'sent' | 'failed' | 'skipped';
  error?: string;
  notificationRecordId?: string;
  toolCallsCount?: number;
  executedTools?: Array<{ toolName: string; args?: Record<string, unknown>; result?: unknown }>;
}
