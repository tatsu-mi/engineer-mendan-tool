export const INTERVIEW_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidCheckpoint(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, any>;
  const progress = input.progress;
  return Number.isSafeInteger(input.durationSeconds) && input.durationSeconds >= 0
    && Number.isSafeInteger(input.resumeVersion) && input.resumeVersion >= 0
    && Number.isSafeInteger(input.revision) && input.revision > 0
    && Array.isArray(input.conversationLog) && input.conversationLog.length <= 300
    && input.conversationLog.every((log: any) => log
      && ['interviewer', 'candidate'].includes(log.role)
      && typeof log.text === 'string' && log.text.trim() && log.text.length <= 20000
      && (log.rawText === undefined || (typeof log.rawText === 'string' && log.rawText.length <= 20000))
      && (log.questionNumber == null || (Number.isInteger(log.questionNumber) && log.questionNumber >= 1 && log.questionNumber <= 20))
      && (log.spokenAt === undefined || (typeof log.spokenAt === 'string' && !Number.isNaN(Date.parse(log.spokenAt)))))
    && input.conversationLog.reduce((total: number, log: any) => total + log.text.length, 0) <= 2000000
    && progress && typeof progress === 'object'
    && Number.isInteger(progress.questionCount) && progress.questionCount >= 0 && progress.questionCount <= 20
    && Number.isInteger(progress.currentQuestionFollowUpCount) && progress.currentQuestionFollowUpCount >= 0 && progress.currentQuestionFollowUpCount <= 100
    && ['reverseQuestionActive', 'sessionStarted', 'selfIntroductionRequested', 'selfIntroductionCompleted',
      'selfIntroductionFollowUpAsked', 'isAwaitingModel'].every(key => typeof progress[key] === 'boolean')
    && ['userTextBuffer', 'aiTextBuffer', 'pendingTurnInstruction'].every(key =>
      typeof progress[key] === 'string' && progress[key].length <= 20000);
}
