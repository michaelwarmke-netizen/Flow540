import type { DeliveryChannel, NotificationDispatchContext, TriggerKey } from './notificationTypes.ts';

export const NOTIFICATION_AGENT_SYSTEM_PROMPT = `
You are an expert AI Agile Coach. Your task is to compose and dispatch a professional, encouraging, and clear notification message for a software engineering team.

Guidelines:
1. Write a well-structured notification message using clean markdown formatting (bullets, bold text, emojis where appropriate).
2. Target the specified Delivery Channel ("email" vs "slack"):
   - For EMAIL delivery: Set channels to ["email"]. Set recipient to { "type": "person", "personId": "<personId>" } where personId is a 20-character person identifier (e.g. "usr_12345678901234567890"). If team person IDs are not provided in the prompt, YOU MUST first call an MCP team lookup tool (e.g. get_team_members, get_project_team, or lookup_users) using the Project Code to fetch member IDs.
   - For SLACK delivery: Set channels to ["slack"]. Set recipient to { "type": "channel", "channelId": "<channelId>" }.
3. When invoking the \`send_notification\` tool, your argument object MUST strictly follow the required schema:
   - "eventType": string (e.g. "ai.pre_retro_preview", "ai.reminder", "ai.post_retro_summary", "ai.action_followup", "ai.insight_share")
   - "channels": array of strings, e.g. ["email"] or ["slack"]
   - "recipient": object with "type" ("person" or "channel"), and "personId" (a 20-character string if type=person) or "channelId" (if type=channel)
   - "subject": string (Subject line for email)
   - "body": string (Plain text notification body)
4. In your final text response, output the exact notification text that was composed and dispatched.
5. CONCISENESS & BREVITY: Keep messages direct, friendly, and brief. Avoid wordy intros or long paragraphs. For action item follow-ups, provide a single friendly intro sentence followed directly by the list of open action items with their assigned owner and current status.

--- FEW-SHOT TOOL CALL EXAMPLES ---

Example 1: Slack Channel Notification for Pre-Retro Preview
User Prompt:
Trigger: preRetroPreview
Delivery Channel: SLACK
Target Slack Channel: #C12345678
Project Code: PROJ-GENENG
Task: Compose a Pre-Retro Topic Preview message inviting team members to review discussion topics before the retro.

Assistant Tool Call:
send_notification({
  "eventType": "ai.pre_retro_preview",
  "channels": ["slack"],
  "recipient": {
    "type": "channel",
    "channelId": "C12345678"
  },
  "subject": "Pre-Retro Agenda Preview: Sprint 10",
  "body": "Hi team! 👋 Here is the preview of our upcoming Retrospective Agenda topics:\n\n1. **Reduce PR Review SLA**: PR turnaround is currently > 24 hours.\n2. **Improve Test Coverage**: Unit test flake rate has increased.\n\nPlease review and accept these topics prior to our meeting!"
})

Example 2: Email Person Notification for Action Item Reminder
User Prompt:
Trigger: ownerReminder
Delivery Channel: EMAIL
From Email: coach@flow.ai
To Email: dev-team@company.com
Project Code: PROJ-PAYMENTS
Task: Compose an Action Item Owner Reminder message for carried-over items.

Assistant Tool Call:
send_notification({
  "eventType": "ai.reminder",
  "channels": ["email"],
  "recipient": {
    "type": "person",
    "personId": "usr_a1b2c3d4e5f6g7h8i9j0"
  },
  "subject": "Action Item Reminder: Update Carried-Over Items",
  "body": "Hi Team,\n\nThis is a friendly reminder to review your carried-over action items before our upcoming retrospective:\n\n- **Update CI pipeline schema** (Owner: Alice, Status: open)\n\nPlease update your progress in the dashboard.\n\nBest regards,\nAgile Coach AI"
})

Example 3: Email Notification requiring MCP Team Lookup first
User Prompt:
Trigger: postRetroSummary
Delivery Channel: EMAIL
To Email: [Not provided in settings - resolve via MCP team lookup tool]
Project Code: PROJ-GENENG
Task: Compose a Post-Retro Personal Summary message.

Assistant Tool Calls:
Step 1: get_team_members({ "project_id": "PROJ-GENENG" })
Step 2: send_notification({
  "eventType": "ai.post_retro_summary",
  "channels": ["email"],
  "recipient": {
    "type": "person",
    "personId": "usr_9k8j7h6g5f4e3d2c1b0a"
  },
  "subject": "Retrospective Summary & Action Items",
  "body": "Hi GenEng Team,\n\nHere is the summary of our completed retrospective session:\n\n1. **Implement Retry Queue** (Assigned: Sarah)\n2. **Update API Gateway Timeout** (Assigned: Mark)\n\nThank you for a productive retro session!"
})
`.trim();

export function buildNotificationPrompt(
  triggerKey: TriggerKey,
  context: NotificationDispatchContext & { projectIdCode?: string },
  channel: DeliveryChannel,
  senderEmail?: string,
  teamEmails?: string
): string {
  let prompt = `Trigger: ${triggerKey}\nDelivery Channel: ${channel.toUpperCase()}\n`;
  if (context.projectIdCode || context.projectId) {
    prompt += `Project Code: ${context.projectIdCode || context.projectId}\n`;
  }

  if (channel === 'slack' && context.slackChannelId) {
    prompt += `Target Slack Channel: #${context.slackChannelId}\n`;
  } else if (channel === 'email') {
    if (senderEmail) prompt += `From Email: ${senderEmail}\n`;
    if (teamEmails && teamEmails.trim()) {
      prompt += `To Email: ${teamEmails.trim()}\n`;
    } else {
      prompt += `To Email: [Not provided in settings - resolve via MCP team lookup tool]\n`;
      prompt += `MCP Team Resolution: Call an available MCP team lookup tool (e.g. get_team_members or get_project_team) using Project Code '${context.projectIdCode || context.projectId}' to retrieve recipient email addresses.\n`;
    }
  }

  if (context.sprintName) prompt += `Sprint: ${context.sprintName}\n`;
  if (context.retroTitle) prompt += `Retrospective: ${context.retroTitle}\n`;

  prompt += `\nContext Details:\n`;

  switch (triggerKey) {
    case 'preRetroPreview':
      prompt += `Upcoming Retrospective Agenda Topics:\n`;
      if (context.topics && context.topics.length > 0) {
        context.topics.forEach((t, i) => {
          prompt += `${i + 1}. **${t.title}**${t.rationale ? `: ${t.rationale}` : ''}\n`;
        });
      } else {
        prompt += `- General sprint review and continuous improvement discussion.\n`;
      }
      prompt += `\nTask: Compose a Pre-Retro Topic Preview message inviting team members to review and accept discussion topics before the retrospective meeting.`;
      break;

    case 'ownerReminder':
      prompt += `Carried-Over Action Items & Assigned Owners:\n`;
      if (context.actionItems && context.actionItems.length > 0) {
        context.actionItems.forEach((item, i) => {
          prompt += `${i + 1}. **${item.title}** (Owner: ${item.owner || 'Unassigned'}, Status: ${item.status || 'open'})\n`;
        });
      } else {
        prompt += `- No carried-over action items outstanding.\n`;
      }
      prompt += `\nTask: Compose an Action Item Owner Reminder message prompting owners to update their carried-over items before the upcoming retrospective.`;
      break;

    case 'postRetroSummary':
      prompt += `Retrospective: ${context.sprintName || context.retroTitle || 'Sprint Retrospective'}\n`;
      if (context.summaryText) {
        prompt += `Executive Summary & Key Takeaways:\n${context.summaryText}\n\n`;
      }
      if (context.proposals && context.proposals.length > 0) {
        prompt += `Newly Created Action Proposals & Commitments:\n`;
        context.proposals.forEach((p, i) => {
          prompt += `${i + 1}. **${p.title}** (Assigned: ${p.owner || 'Unassigned'})\n   ${p.description || ''}\n`;
        });
      } else if (context.actionItems && context.actionItems.length > 0) {
        prompt += `Action Items & Commitments:\n`;
        context.actionItems.forEach((item, i) => {
          prompt += `${i + 1}. **${item.title}** (Owner: ${item.owner || 'Unassigned'})\n`;
        });
      } else {
        prompt += `Key Retrospective Takeaways:\n- Retrospective completed successfully with team process improvements identified.\n`;
      }
      prompt += `\nTask: Compose a Post-Retro Personal Summary message summarizing session completion, executive takeaways, and assigned action items for participants.`;
      break;

    case 'actionFollowup':
      prompt += `Current Open Action Items:\n`;
      if (context.actionItems && context.actionItems.length > 0) {
        context.actionItems.forEach((item, i) => {
          prompt += `${i + 1}. **${item.title}** — Owner: ${item.owner || 'Unassigned'} | Status: ${item.status || 'open'}\n`;
        });
      } else {
        prompt += `- No open action items currently being tracked.\n`;
      }
      prompt += `\nTask: Compose a brief, friendly Mid-Sprint Action Follow-Up message. Keep it short and concise: write 1 short friendly reminder sentence followed directly by the list of current open action items showing item title, assigned owner, and status. Do not include long paragraphs or unnecessary summary text.`;
      break;

    case 'insightShare':
      prompt += `Agile Coach Detected Team Insights & Patterns:\n`;
      if (context.insights && context.insights.length > 0) {
        context.insights.forEach((ins, i) => {
          prompt += `${i + 1}. **${ins.title}** (${ins.insight_type || 'pattern'})\n   ${ins.description}\n`;
        });
      } else {
        prompt += `- Team velocity and process trends are currently being monitored.\n`;
      }
      prompt += `\nTask: Compose a Coach Insight Share message highlighting team positive trends, blind spots, and detected operational patterns.`;
      break;

    default:
      prompt += `Automated Agile Coach notification update.\n`;
      break;
  }

  prompt += `\n\nIf you have access to a tool to send this message to ${channel.toUpperCase()}, execute that tool call now. Afterwards, output the exact notification text.`;

  return prompt;
}
