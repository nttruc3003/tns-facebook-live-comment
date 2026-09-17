import { randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import { stream } from './store.js';
import {
  filterSchema,
  normalize,
  type Filter,
  type Comment,
  type Analysis,
} from '../shared/types.js';
export function evaluate(
  db: Store,
  streamId: string,
  raw: Filter,
  user: string,
  title: string,
): Analysis {
  const filter = filterSchema.parse(raw);
  const live = stream(db, streamId);
  if (!live) throw new Error('Không tìm thấy livestream.');
  if (!!filter.startCommentId !== !!filter.endCommentId)
    throw new Error('Chọn đủ hai mốc bắt đầu và kết thúc, hoặc bỏ cả hai để tính toàn phiên.');
  let start: Comment | undefined;
  let end: Comment | undefined;
  if (filter.startCommentId && filter.endCommentId) {
    start = db
      .prepare('SELECT * FROM comments WHERE streamId=? AND id=? AND deleted=0')
      .get(streamId, filter.startCommentId) as Comment | undefined;
    end = db
      .prepare('SELECT * FROM comments WHERE streamId=? AND id=? AND deleted=0')
      .get(streamId, filter.endCommentId) as Comment | undefined;
    if (!start || !end) throw new Error('Mốc không thuộc livestream này hoặc đã bị xóa.');
    if (!start.authorId || start.authorId !== end.authorId)
      throw new Error('Hai mốc cần cùng ID tác giả xác định được.');
    if (live.kind === 'browser' ? start.seq >= end.seq : start.createdAt >= end.createdAt)
      throw new Error('Thời gian bắt đầu phải trước thời gian kết thúc.');
  }
  const clauses = ['streamId=@streamId', 'deleted=0'];
  const params: Record<string, string | number> = { streamId, text: normalize(filter.text) };
  if (start && end) {
    clauses.push(
      live.kind === 'browser' ? 'seq>@start AND seq<@end' : 'createdAt>@start AND createdAt<@end',
    );
    params.start = live.kind === 'browser' ? start.seq : start.createdAt;
    params.end = live.kind === 'browser' ? end.seq : end.createdAt;
  }
  if (!filter.includeReplies) clauses.push('parentId IS NULL');
  if (filter.excludeHost) {
    if (live.kind === 'browser') {
      if (!start?.authorId)
        throw new Error(
          'Nguồn trình duyệt: chọn hai mốc cùng tác giả để loại tác giả mốc, hoặc bỏ tùy chọn loại chủ live.',
        );
      clauses.push('(authorId IS NULL OR authorId!=@hostAuthor)');
      params.hostAuthor = start.authorId;
    } else clauses.push('isHost=0');
  }
  clauses.push(filter.match === 'exact' ? 'normalized=@text' : 'instr(normalized,@text)>0');
  const matches = db
    .prepare(`SELECT * FROM comments WHERE ${clauses.join(' AND ')} ORDER BY createdAt,seq`)
    .all(params) as Comment[];
  const unknownAuthors = matches.filter((c) => !c.authorId).length;
  const count = filter.distinctUsers
    ? new Set(matches.map((c) => c.authorId).filter(Boolean)).size
    : matches.length;
  const boundaryTies =
    start && end && live.kind !== 'browser'
      ? (
          db
            .prepare(
              'SELECT count(*) n FROM comments WHERE streamId=? AND createdAt IN (?,?) AND id NOT IN (?,?) AND deleted=0',
            )
            .get(streamId, start.createdAt, end.createdAt, start.id, end.id) as { n: number }
        ).n
      : 0;
  return {
    id: randomUUID(),
    streamId,
    title,
    createdAt: Date.now(),
    createdBy: user,
    filter,
    count,
    commentCount: matches.length,
    unknownAuthors,
    boundaryTies,
    provisional: live.kind === 'browser' || !!live.collecting,
    warning:
      live.kind === 'browser'
        ? 'Dữ liệu trình duyệt có thể thiếu/trùng. Mốc tính theo thứ tự ghi nhận, không phải thứ tự gửi trên Facebook. Danh tính dựa trên link profile nếu có; host/replies có thể chưa xác định. Không dùng làm căn cứ duy nhất để trao giải.' +
          (live.error ? ` ${live.error}` : '')
        : live.error,
    matches,
  };
}
export function recordAnalysis(db: Store, result: Analysis) {
  db.prepare(
    'INSERT INTO analysis_runs(id,streamId,title,createdAt,createdBy,result) VALUES (?,?,?,?,?,?)',
  ).run(
    result.id,
    result.streamId,
    result.title,
    result.createdAt,
    result.createdBy,
    JSON.stringify(result),
  );
}
export function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function commentsCsv(comments: Comment[]) {
  return (
    '\uFEFF' +
    [
      [
        'ID',
        'Tác giả ID',
        'Tên',
        'Avatar URL',
        'Nội dung',
        '1st number',
        '2nd number',
        'Thời gian',
        'Nhận lúc',
        'Nguồn thời gian',
        'Nguồn danh tính',
        'Nguồn ID comment',
      ],
      ...comments.map((c) => [
        c.id,
        c.authorId,
        c.authorName,
        c.avatarUrl,
        c.message,
        c.firstNumber,
        c.secondNumber,
        new Date(c.createdAt).toISOString(),
        new Date(c.receivedAt).toISOString(),
        c.timeBasis || 'facebook',
        c.identityBasis || 'facebook-id',
        c.idBasis || 'facebook-id',
      ]),
    ]
      .map((r) => r.map(csvCell).join(','))
      .join('\r\n')
  );
}
