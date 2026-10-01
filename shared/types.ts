import { z } from 'zod';
export type Role = 'admin' | 'operator' | 'viewer';
export type User = { id: string; name: string; username: string; role: Role };
export type Stream = {
  id: string;
  sourceId: string | null;
  facebookId: string | null;
  title: string;
  pageName: string;
  url: string;
  status: string;
  kind: 'demo' | 'facebook' | 'browser';
  createdAt: number;
  collecting: number;
  lastSync: number | null;
  error: string | null;
  commentCount: number;
  participantCount: number;
};
export type Comment = {
  seq: number;
  id: string;
  streamId: string;
  authorId: string | null;
  authorName: string;
  avatarUrl?: string | null;
  firstNumber?: string | null;
  secondNumber?: string | null;
  thirdNumber?: string | null;
  aiNumberNote?: string | null;
  numbersRevision?: number;
  message: string;
  normalized: string;
  createdAt: number;
  receivedAt: number;
  parentId: string | null;
  isHost: number;
  deleted: number;
  timeBasis?: 'facebook' | 'observed';
  identityBasis?: 'facebook-id' | 'profile-url' | 'unknown';
  idBasis?: 'facebook-id' | 'observation';
};
export const filterSchema = z
  .object({
    text: z.string().trim().min(1).max(200),
    match: z.enum(['exact', 'contains']),
    startCommentId: z.string().max(200).nullable(),
    endCommentId: z.string().max(200).nullable(),
    distinctUsers: z.boolean(),
    includeReplies: z.boolean(),
    excludeHost: z.boolean(),
  })
  .strict();
export type Filter = z.infer<typeof filterSchema>;
export const defaultFilter: Filter = {
  text: '5',
  match: 'exact',
  startCommentId: null,
  endCommentId: null,
  distinctUsers: true,
  includeReplies: false,
  excludeHost: true,
};
export type Analysis = {
  id: string;
  streamId: string;
  title: string;
  createdAt: number;
  createdBy: string;
  filter: Filter;
  count: number;
  commentCount: number;
  unknownAuthors: number;
  boundaryTies: number;
  provisional: boolean;
  warning: string | null;
  matches: Comment[];
};
export const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('vi');

const relativeFacebookTime =
  /^(?:just now|vừa xong|\d{1,4}\s*(?:s|m|h|d|w|min|mins|hr|hrs|giây|phút|giờ|ngày|tuần))$/iu;
const presenceLabel = /online\s+status\s+indicator\s*(?:active|inactive)?/iu;

export function sanitizeBrowserComment(authorName: string, message: string) {
  let cleanAuthor = authorName.replace(/\s+/g, ' ').trim();
  let lines = message
    .replaceAll('\r', '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (presenceLabel.test(cleanAuthor)) {
    const candidate = lines[0];
    const remaining = lines.slice(1).filter((line) => !relativeFacebookTime.test(line));
    if (
      candidate &&
      !relativeFacebookTime.test(candidate) &&
      !presenceLabel.test(candidate) &&
      remaining.length
    ) {
      cleanAuthor = candidate.replace(/\s+/g, ' ').slice(0, 200);
      lines.shift();
    } else cleanAuthor = 'Người dùng Facebook';
  }
  lines = lines.filter((line) => !relativeFacebookTime.test(line) && !presenceLabel.test(line));
  return { authorName: cleanAuthor, message: lines.join('\n').trim() };
}

export const numberFields = ['firstNumber', 'secondNumber', 'thirdNumber'] as const;
export type NumberField = (typeof numberFields)[number];
export type NumberDraft = Partial<Record<NumberField, string>>;
