import type { DeliveryChannel, NotificationDispatchContext, TriggerKey } from './notificationTypes.ts';

export const NOTIFICATION_AGENT_SYSTEM_PROMPT = `
You are an expert AI Agile Coach. Your task is to compose and dispatch a professional, encouraging, and clear notification message for a software engineering team.

Guidelines:
1. Write a well-structured notification message using clean markdown formatting (bullets, bold text, emojis where appropriate).
2. Make the message action-oriented, helpful, and concise.
3. If an appropriate MCP tool is available to deliver this message (such as a Slack message posting tool or an email sending tool), YOU MUST CALL THAT TOOL to deliver the notification.
4. For Slack delivery, target the specified Slack channel if provided.
5. In your final text response, output the exact notification text that was composed and dispatched.
`.trim();

export function buildNotificationPrompt(
  triggerKey: TriggerKey,
  context: NotificationDispatchContext,
  channel: DeliveryChannel,
  senderEmail?: string,
  teamEmails?: string
): string {
  let prompt = `Trigger: ${triggerKey}\nDelivery Channel: ${channel.toUpperCase()}\n`;

  if (channel === 'slack' && context.slackChannelId) {
    prompt += `Target Slack Channel: #${context.slackChannelId}\n`;
  } else if (channel === 'email') {
    if (senderEmail) prompt += `From Email: ${senderEmail}\n`;
    if (teamEmails) prompt += `To Email: ${teamEmails}\n`;
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
      prompt += `Newly Created Action Proposals / Commitments:\n`;
      if (context.proposals && context.proposals.length > 0) {
        context.proposals.forEach((p, i) => {
          prompt += `${i + 1}. **${p.title}** (Assigned: ${p.owner || 'Unassigned'})\n   ${p.description || ''}\n`;
        });
      } else {
        prompt += `- Retrospective completed successfully.\n`;
      }
      prompt += `\nTask: Compose a Post-Retro Personal Summary message summarizing session completion and assigned action items for participants.`;
      break;

    case 'actionFollowup':
      prompt += `In-Progress Sprint Action Items:\n`;
      if (context.actionItems && context.actionItems.length > 0) {
        context.actionItems.forEach((item, i) => {
          prompt += `${i + 1}. **${item.title}** (Owner: ${item.owner || 'Unassigned'}, Status: ${item.status || 'in_progress'})\n`;
        });
      } else {
        prompt += `- Action items currently being tracked for mid-sprint progress.\n`;
      }
      prompt += `\nTask: Compose a Mid-Sprint Action Follow-Up message checking in on team progress for assigned action items.`;
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
