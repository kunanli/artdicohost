import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { validateContent, toPublicContent } from '../../shared/content-schema.mjs';
import { createInitialContent } from '../../src/config/content.mjs';

const queues = new Map();

export class ContentError extends Error {
  constructor(code, message, status = 400, fields) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

function checkedContent(input) {
  const result = validateContent(input);
  if (!result.valid) throw new ContentError('VALIDATION_ERROR', '内容未通过校验。', 422, result.errors);
  return result.value;
}

function checkRevision(expected, actual) {
  if (!Number.isSafeInteger(expected) || expected < 0) throw new ContentError('INVALID_REVISION', '请提供有效的预期修订号。');
  if (expected !== actual) throw new ContentError('REVISION_CONFLICT', '内容已被更新，请重新载入后再决定。', 409);
}

function envelope(state) {
  return structuredClone({ draft: state.draft, published: state.published });
}

/** Single-process local storage; deliberately provides no cross-process or cloud lock. */
export function createFileContentStore({ directory, initialContent = createInitialContent(), now = () => Date.now() }) {
  if (!directory) throw new TypeError('必须指定本地内容目录。');
  const root = resolve(directory);
  const file = join(root, 'content.json');
  const seed = checkedContent(initialContent);

  async function load() {
    try {
      const state = JSON.parse(await readFile(file, 'utf8'));
      if (state.storageVersion !== 1 || !Number.isSafeInteger(state.draft?.revision) || state.draft.revision < 0 || !Array.isArray(state.audit)) throw new Error('Invalid state');
      state.draft.content = checkedContent(state.draft.content);
      if (state.published !== null) {
        if (!Number.isSafeInteger(state.published?.revision) || state.published.revision < 0 || typeof state.published.publishedAt !== 'string') throw new Error('Invalid publication');
        state.published.content = toPublicContent(state.published.content);
      }
      return state;
    } catch (error) {
      if (error.code === 'ENOENT') return { storageVersion: 1, draft: { revision: 0, content: structuredClone(seed) }, published: null, audit: [] };
      throw new ContentError('STORAGE_ERROR', '本地内容文件不可读取；请先检查备份，不要覆盖原文件。', 503);
    }
  }

  async function commit(state) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const temporary = join(root, `.content-${randomBytes(12).toString('hex')}.tmp`);
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, file);
    } catch {
      throw new ContentError('STORAGE_ERROR', '本地保存未完成，原有内容未确认改变，请重新载入。', 503);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporary).catch(() => {});
    }
  }

  function serial(operation) {
    const result = (queues.get(file) ?? Promise.resolve()).then(operation);
    queues.set(file, result.catch(() => {}));
    return result;
  }

  return {
    read: () => serial(async () => envelope(await load())),
    save: (expectedRevision, input, actorId) => serial(async () => {
      const state = await load();
      checkRevision(expectedRevision, state.draft.revision);
      const content = checkedContent(input);
      if (content.eventId !== state.draft.content.eventId) throw new ContentError('VALIDATION_ERROR', '本后台只维护当前活动。', 422, { eventId: '活动 ID 不可更改。' });
      state.draft = { revision: state.draft.revision + 1, content };
      state.audit.push({ action: 'save_draft', actorId, revision: state.draft.revision, at: new Date(now()).toISOString() });
      await commit(state);
      return structuredClone(state.draft);
    }),
    publish: (expectedRevision, actorId) => serial(async () => {
      const state = await load();
      checkRevision(expectedRevision, state.draft.revision);
      if (state.published?.revision === state.draft.revision) return structuredClone(state.published);
      state.published = { revision: state.draft.revision, publishedAt: new Date(now()).toISOString(), content: toPublicContent(state.draft.content) };
      state.audit.push({ action: 'publish', actorId, revision: state.draft.revision, at: state.published.publishedAt });
      await commit(state);
      return structuredClone(state.published);
    }),
  };
}
