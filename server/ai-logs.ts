import { randomUUID } from 'node:crypto';
import type { Store } from './store.js';

export function redactAILog(text: string, secret = '') {
  const withoutSecret = secret ? text.split(secret).join('[REDACTED]') : text;
  return withoutSecret.replace(/\bsk-(?:ant-)?[A-Za-z0-9_-]+/g, '[REDACTED]');
}
export interface AITrace {
  request(url: string, body: string): void;
  response(attempt: number, status: number, body: string, requestId: string | null): void;
}
export class AutofillLog implements AITrace {
  readonly id = randomUUID();
  private attempts: {
    attempt: number;
    status: number;
    body: string;
    requestId: string | null;
    receivedAt: number;
  }[] = [];
  constructor(
    private db: Store,
    streamId: string,
    userId: string,
    config: { provider: string; model: string },
    count: number,
  ) {
    db.prepare(
      'INSERT INTO ai_call_logs(id,streamId,userId,createdAt,provider,model,commentCount,status,attempts) VALUES (?,?,?,?,?,?,?,?,?)',
    ).run(
      this.id,
      streamId,
      userId,
      Date.now(),
      config.provider,
      config.model,
      count,
      'pending',
      '[]',
    );
  }
  request(url: string, body: string) {
    this.db
      .prepare('UPDATE ai_call_logs SET endpoint=?,requestBody=? WHERE id=?')
      .run(url, body, this.id);
  }
  response(attempt: number, status: number, body: string, requestId: string | null) {
    this.attempts.push({ attempt, status, body, requestId, receivedAt: Date.now() });
    this.db
      .prepare('UPDATE ai_call_logs SET attempts=? WHERE id=?')
      .run(JSON.stringify(this.attempts), this.id);
  }
  complete(result: unknown) {
    this.db
      .prepare("UPDATE ai_call_logs SET status='completed',finishedAt=?,result=? WHERE id=?")
      .run(Date.now(), redactAILog(JSON.stringify(result)), this.id);
  }
  fail(error: string) {
    this.db
      .prepare("UPDATE ai_call_logs SET status='error',finishedAt=?,error=? WHERE id=?")
      .run(Date.now(), redactAILog(error), this.id);
  }
}
