import { decodeHtml, fetchJson, isRecord, ResponseSchemaError } from './common.js';
import {
  removeSubjectInterest,
  SUBJECT_ACTIONS,
  submitSubjectInterestForm,
  type SubjectActionKind,
  type SubjectInterest
} from './mutations.js';

/** The signed-in account's own record for one movie or book. */
export interface SubjectRecord {
  kind: SubjectActionKind;
  id: string;
  url: string;
  /** `none` when the subject is not marked. */
  status: SubjectInterest;
  rating: number | null;
  comment: string;
  tags: string[];
  private: boolean;
}

/** Fields to change; omitted fields keep their current value. */
export interface RecordPatch {
  status?: Exclude<SubjectInterest, 'none'>;
  rating?: number | null;
  comment?: string;
  tags?: string[];
  private?: boolean;
}

export interface RecordChange {
  before: SubjectRecord;
  after: SubjectRecord;
  changed: boolean;
  dryRun: boolean;
}

export interface RecordWriteOptions {
  dryRun?: boolean;
  ck?: string;
}

const MAX_COMMENT_LENGTH = 350;

interface RecordForm {
  record: SubjectRecord;
  /** Hidden fields Douban expects back unchanged, such as `foldcollect`. */
  passthrough: Record<string, string>;
}

const STATUSES = new Set<SubjectInterest>(['collect', 'wish', 'do']);

function parseAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const match of tag.replace(/^<\w+|\/?>$/g, '').matchAll(pattern)) {
    attributes.set(match[1].toLowerCase(), decodeHtml(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return attributes;
}

function inputs(html: string): Map<string, string>[] {
  return [...html.matchAll(/<input\b[^>]*>/gi)].map((match) => parseAttributes(match[0]));
}

function recordUrl(kind: SubjectActionKind, id: string): string {
  if (!/^\d+$/.test(id)) throw new Error('条目 ID 必须是纯数字');
  return `${SUBJECT_ACTIONS[kind].baseUrl}/j/subject/${id}/interest`;
}

/** Parse the JSON envelope and edit form returned by `/j/subject/<id>/interest`. */
export function parseRecordForm(payload: unknown, kind: SubjectActionKind, id: string): RecordForm {
  const url = recordUrl(kind, id);
  if (!isRecord(payload) || typeof payload.html !== 'string') {
    throw new ResponseSchemaError('个人记录接口没有返回编辑表单，请确认登录状态', url);
  }
  const html = payload.html;
  const fields = inputs(html);
  const named = (name: string) => fields.filter((field) => field.get('name') === name);

  const checked = named('interest').filter((field) => field.has('checked'));
  if (checked.length > 1) throw new ResponseSchemaError('编辑表单存在多个选中的收藏状态', url);
  const rawStatus = typeof payload.interest_status === 'string' && payload.interest_status
    ? payload.interest_status
    : checked[0]?.get('value') ?? '';
  const status: SubjectInterest = rawStatus === '' ? 'none' : rawStatus as SubjectInterest;
  if (status !== 'none' && !STATUSES.has(status)) throw new ResponseSchemaError(`无法识别收藏状态：${rawStatus}`, url);

  const ratingField = named('rating')[0];
  const privateField = named('private')[0];
  const commentMatch = html.match(/<textarea\b[^>]*\bname=["']?comment\b[^>]*>([\s\S]*?)<\/textarea>/i);
  if (!ratingField || !privateField || !commentMatch || named('tags').length === 0) {
    throw new ResponseSchemaError('编辑表单缺少评分、短评、标签或可见性字段，无法安全保留原记录', url);
  }

  const rawRating = ratingField.get('value') ?? '';
  const rating = rawRating === '' || rawRating === '0' ? null : Number(rawRating);
  if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
    throw new ResponseSchemaError(`原评分字段无效：${rawRating}`, url);
  }

  const tags = Array.isArray(payload.tags)
    ? payload.tags.filter((tag): tag is string => typeof tag === 'string')
    : (named('tags')[0]?.get('value') ?? '').split(/\s+/);

  const passthrough: Record<string, string> = {};
  for (const field of fields) {
    const name = field.get('name');
    if (name && field.get('type') === 'hidden' && name !== 'rating' && name !== 'ck') {
      passthrough[name] = field.get('value') ?? '';
    }
  }

  return {
    record: {
      kind,
      id,
      url: `${SUBJECT_ACTIONS[kind].baseUrl}/subject/${id}/`,
      status,
      rating,
      comment: decodeHtml(commentMatch[1]).replace(/\r\n/g, '\n'),
      tags: tags.map((tag) => tag.trim()).filter(Boolean),
      private: privateField.has('checked')
    },
    passthrough
  };
}

async function readRecordForm(kind: SubjectActionKind, id: string, cookies: string): Promise<RecordForm> {
  const payload = await fetchJson<unknown>(recordUrl(kind, id), {
    Cookie: cookies,
    Referer: `${SUBJECT_ACTIONS[kind].baseUrl}/subject/${id}/`,
    'X-Requested-With': 'XMLHttpRequest'
  });
  return parseRecordForm(payload, kind, id);
}

export async function getSubjectRecord(kind: SubjectActionKind, id: string, cookies: string): Promise<SubjectRecord> {
  return (await readRecordForm(kind, id, cookies)).record;
}

function applyRecordPatch(before: SubjectRecord, patch: RecordPatch): SubjectRecord {
  if (patch.rating != null && !(Number.isInteger(patch.rating) && patch.rating >= 1 && patch.rating <= 5)) {
    throw new Error('评分必须是 1-5 的整数');
  }
  if (patch.comment !== undefined && [...patch.comment].length > MAX_COMMENT_LENGTH) {
    throw new Error(`短评不能超过 ${MAX_COMMENT_LENGTH} 字`);
  }
  if (patch.tags?.some((tag) => !tag || /\s/.test(tag))) {
    throw new Error('标签不能为空，也不能包含空白字符');
  }
  const status = patch.status ?? before.status;
  if (status === 'none') throw new Error('该条目尚未标记，请同时指定状态');
  // Douban keeps no rating for 想看/想读, so a rating would never read back.
  if (status === 'wish' && patch.rating != null) throw new Error('“想看/想读”状态不能评分');
  const rating = status === 'wish' ? null : patch.rating !== undefined ? patch.rating : before.rating;
  return {
    ...before,
    status,
    rating,
    comment: patch.comment !== undefined ? patch.comment.replace(/\r\n/g, '\n') : before.comment,
    tags: patch.tags !== undefined ? [...new Set(patch.tags)] : before.tags,
    private: patch.private ?? before.private
  };
}

function sameRecord(a: SubjectRecord, b: SubjectRecord): boolean {
  return a.status === b.status
    && a.rating === b.rating
    && a.comment.trim() === b.comment.trim()
    && a.private === b.private
    && [...a.tags].sort().join('\n') === [...b.tags].sort().join('\n');
}

/**
 * Read the current record, change only the patched fields, submit the whole
 * form and read it back. The "share to broadcast" box is never submitted.
 */
export async function editSubjectRecord(
  kind: SubjectActionKind,
  id: string,
  patch: RecordPatch | ((before: SubjectRecord) => RecordPatch),
  cookies: string,
  options: RecordWriteOptions = {}
): Promise<RecordChange> {
  const { record: before, passthrough } = await readRecordForm(kind, id, cookies);
  const after = applyRecordPatch(before, typeof patch === 'function' ? patch(before) : patch);
  const changed = !sameRecord(before, after);
  if (options.dryRun || !changed) return { before, after, changed, dryRun: Boolean(options.dryRun) };

  await submitSubjectInterestForm(SUBJECT_ACTIONS[kind], id, {
    ...passthrough,
    interest: after.status,
    rating: after.rating === null ? '' : String(after.rating),
    tags: after.tags.join(' '),
    comment: after.comment,
    private: after.private ? 'on' : undefined
  }, cookies, options.ck);

  const verified = await getSubjectRecord(kind, id, cookies);
  if (!sameRecord(verified, after)) {
    throw new Error(`提交后读回的记录与预期不一致，请运行 record ${id} 核对；不会自动重试`);
  }
  return { before, after: verified, changed: true, dryRun: false };
}

/** Remove the record entirely, then confirm it reads back as unmarked. */
export async function removeSubjectRecord(
  kind: SubjectActionKind,
  id: string,
  cookies: string,
  options: RecordWriteOptions = {}
): Promise<RecordChange> {
  const before = await getSubjectRecord(kind, id, cookies);
  const after: SubjectRecord = { ...before, status: 'none', rating: null, comment: '', tags: [], private: false };
  const changed = before.status !== 'none';
  if (options.dryRun || !changed) return { before, after, changed, dryRun: Boolean(options.dryRun) };

  await removeSubjectInterest(SUBJECT_ACTIONS[kind], id, cookies, options.ck);
  const verified = await getSubjectRecord(kind, id, cookies);
  if (verified.status !== 'none') {
    throw new Error(`取消标记后读回的状态仍为 ${verified.status}，请运行 record ${id} 核对`);
  }
  return { before, after: verified, changed: true, dryRun: false };
}
