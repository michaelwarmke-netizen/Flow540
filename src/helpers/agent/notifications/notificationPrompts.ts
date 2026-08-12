import type { DeliveryChannel, NotificationDispatchContext, TriggerKey } from './notificationTypes.ts';

export const NOTIFICATION_AGENT_SYSTEM_PROMPT = `
You are an expert AI Agile Coach. Your task is to compose and dispatch a professional, encouraging, and clear notification message for a software engineering team.

Guidelines:
1. Write a well-structured notification message using clean markdown formatting (bullets, bold text, emojis where appropriate).
2. Target the specified Delivery Channel (EMAIL vs SLACK):
   - For EMAIL delivery: Call an email sending tool (e.g. send_email, email_notification, or send_notification). If recipient email addresses are missing or not provided in the prompt, YOU MUST first call an MCP team lookup tool (e.g. get_team_members, get_project_team, or lookup_users) to resolve team member emails for the Project Code.
   - For SLACK delivery: Call a Slack sending tool (e.g. send_slack_message or post_notification) targeting the specified Slack channel.
3. When invoking any tool, YOU MUST ALWAYS PROVIDE COMPLETE ARGUMENTS:
   - For email sending tools: pass "to" / "recipient" (email addresses), "subject", and "message" / "body".
   - For team lookup tools: pass "project_id" or "team_id".
   - For Slack tools: pass "channel" or "slack_channel", and "message" / "text".
4. In your final text response, output the exact notification text that was composed and dispatched.
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
