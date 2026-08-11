import { describe, it } from 'node:test';
import assert from 'node:assert';
import { NotificationDispatcher } from './notificationDispatcher.ts';
import { buildNotificationPrompt } from './notificationPrompts.ts';
import type { NotificationDispatchContext } from './notificationTypes.ts';

describe('NotificationDispatcher & Prompts', () => {
  it('buildNotificationPrompt constructs rich prompt for preRetroPreview', () => {
    const context: NotificationDispatchContext = {
      projectId: 'proj-1',
      slackChannelId: 'C12345678',
      sprintName: 'Sprint 10',
      topics: [
        { title: 'Reduce PR Review SLA', rationale: 'PR turnaround > 24 hours' },
        { title: 'Improve Test Coverage', rationale: 'Flaky unit test rate elevated' },
      ],
    };

    const prompt = buildNotificationPrompt('preRetroPreview', context, 'slack');

    assert.match(prompt, /Trigger: preRetroPreview/);
    assert.match(prompt, /Target Slack Channel: #C12345678/);
    assert.match(prompt, /Reduce PR Review SLA/);
    assert.match(prompt, /Improve Test Coverage/);
  });

  it('buildNotificationPrompt constructs rich prompt for ownerReminder', () => {
    const context: NotificationDispatchContext = {
      projectId: 'proj-1',
      slackChannelId: 'C12345678',
      actionItems: [
        { title: 'Update CI pipeline schema', owner: 'Alice', status: 'open' },
      ],
    };

    const prompt = buildNotificationPrompt('ownerReminder', context, 'email', 'coach@flow.ai', 'team@flow.ai');

    assert.match(prompt, /Delivery Channel: EMAIL/);
    assert.match(prompt, /From Email: coach@flow.ai/);
    assert.match(prompt, /Update CI pipeline schema/);
    assert.match(prompt, /Alice/);
  });

  it('skips dispatch when trigger is disabled in project settings', async () => {
    const mockRepo = {
      getProject: async (_id: string) => ({
        id: 'proj-1',
        name: 'Test Project',
        notification_settings: JSON.stringify({
          preRetroPreview: { enabled: false, channel: 'slack' },
        }),
      }),
      saveSlackNotification: async () => {
        throw new Error('Should not call saveSlackNotification for disabled trigger');
      },
    };

    const dispatcher = new NotificationDispatcher(mockRepo);
    const result = await dispatcher.dispatch('preRetroPreview', { projectId: 'proj-1' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.content, '');
  });

  it('handles project not found non-fatally when throwOnError is false', async () => {
    const mockRepo = {
      getProject: async () => null,
    };

    const dispatcher = new NotificationDispatcher(mockRepo);
    const result = await dispatcher.dispatch('postRetroSummary', { projectId: 'non-existent' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 'failed');
    assert.match(result.error || '', /Project not found/);
  });

  it('throws error when project not found if throwOnError is true', async () => {
    const mockRepo = {
      getProject: async () => null,
    };

    const dispatcher = new NotificationDispatcher(mockRepo);

    await assert.rejects(
      async () => {
        await dispatcher.dispatch('postRetroSummary', { projectId: 'non-existent' }, { throwOnError: true });
      },
      (err: any) => {
        return /Project not found/.test(err.message);
      }
    );
  });
});
