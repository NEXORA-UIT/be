import { retryPendingObjectCleanups } from '../modules/collaboration/services/collaboration.service.js';
import { createDueSoonReminders } from '../modules/notifications/services/due-reminder.service.js';

export async function runScheduledJobs() {
  const results: Record<string, unknown> = {};
  let failed = false;

  try {
    results.attachmentCleanup = await retryPendingObjectCleanups();
  } catch (error) {
    console.error('Attachment cleanup could not run:', error);
    results.attachmentCleanup = { error: 'EXECUTION_FAILED' };
    failed = true;
  }

  try {
    results.dueReminders = await createDueSoonReminders();
  } catch (error) {
    console.error('Due reminders could not run:', error);
    results.dueReminders = { error: 'EXECUTION_FAILED' };
    failed = true;
  }

  return { completedAt: new Date().toISOString(), ...results, failed };
}
