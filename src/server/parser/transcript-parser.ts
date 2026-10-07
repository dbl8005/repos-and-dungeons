import path from 'node:path';
import type { GameEvent, HeroClass, HeroId } from '../../shared/events.js';
import { detectTestRun } from '../tests-detect/index.js';
import { contextLimit, modelToClass } from './model-class.js';

export type ParserOptions = {
  repoRoot: string;
  /** Other spellings of the repo root, e.g. through a symlink the session's cwd used. */
  aliasRoots?: string[];
  hero: HeroId;
  parent?: HeroId;
  now?: () => number;
  /** When given, scout paths not on the map are dropped (defense against content lines that look like paths). */
  isKnownPath?: (path: string) => boolean;
};
export type TranscriptParser = { feed(line: string): GameEvent[] };

type Pending = { name: string; input: Record<string, unknown> };
type Body = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, 't' | 'hero'> : never) : never;

const FORGE_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit']);
const SCOUT_TOOLS = new Set(['Grep', 'Glob', 'LS']);
const MAX_SCOUT_PATHS = 50;

const ENV_PREFIX = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"(?:[^"\\]|\\.)*"|[^\s'"]*)\s+)*/;
const SAFE_PROGRAM = /^[A-Za-z0-9._+-]{1,40}$/;

/**
 * The program a shell command runs, without env assignments or directories (which can hold secrets).
 * Anything that isn't a plain program name (quoted, `$VAR`, backticks, too long) becomes ''.
 */
export function programName(command: string): string {
  const rest = command.replace(ENV_PREFIX, '');
  const token = rest.match(/^[^\s'"`$;&|()<>\\]+/)?.[0];
  if (!token) return '';
  const next = rest.charAt(token.length);
  if (next && !/\s/.test(next)) return '';
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) return '';
  const base = path.posix.basename(token);
  return SAFE_PROGRAM.test(base) ? base : '';
}

export function createParser(opts: ParserOptions): TranscriptParser {
  const now = opts.now ?? Date.now;
  const pending = new Map<string, Pending>();
  let heroClass: HeroClass | null = null;

  const roots = [opts.repoRoot, ...(opts.aliasRoots ?? [])];
  const toRel = (p: unknown): string | null => {
    if (typeof p !== 'string' || !p) return null;
    for (const root of roots) {
      const rel = path.relative(root, path.resolve(root, p));
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
    }
    return null;
  };

  const resultText = (content: unknown): string => {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('\n');
    return '';
  };

  const scoutPaths = (text: string): string[] => {
    const out: string[] = [];
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || /^(Found \d+|No (files|matches))/.test(line)) continue;
      // Grep output can be `path:line:content`, `path:content` or `path-line-content` (context); keep the path only.
      const candidate = line.split(':')[0].replace(/-\d+-.*$/, '');
      if (!/[./]/.test(candidate) || /['"`=;$]/.test(candidate)) continue;
      const rel = toRel(candidate);
      if (rel && opts.isKnownPath && !opts.isKnownPath(rel)) continue;
      if (rel && !out.includes(rel)) out.push(rel);
      if (out.length >= MAX_SCOUT_PATHS) break;
    }
    return out;
  };

  return {
    feed(line: string): GameEvent[] {
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        return [];
      }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
      const parsedT = typeof obj.timestamp === 'string' ? Date.parse(obj.timestamp) : NaN;
      const t = Number.isFinite(parsedT) ? parsedT : now();
      const out: GameEvent[] = [];
      const emit = (body: Body) => out.push({ t, hero: opts.hero, ...body } as GameEvent);

      if (obj.type === 'system' && obj.subtype === 'compact_boundary') {
        emit({ kind: 'compacted' });
        return out;
      }

      const msg = obj.message;
      if (!msg || typeof msg !== 'object') return out;

      if (obj.type === 'assistant') {
        const model = typeof msg.model === 'string' ? msg.model : '';
        if (model && model !== '<synthetic>') {
          const cls = modelToClass(model);
          if (cls !== heroClass) {
            heroClass = cls;
            emit({ kind: 'hero_joined', heroClass: cls, label: opts.hero.slice(0, 8), ...(opts.parent ? { parent: opts.parent } : {}) });
          }
        }
        const content: any[] = Array.isArray(msg.content) ? msg.content : [];
        let sawTool = false;
        for (const c of content) {
          if (!c || c.type !== 'tool_use' || typeof c.name !== 'string') continue;
          sawTool = true;
          const input = c.input && typeof c.input === 'object' ? c.input : {};
          pending.set(c.id, { name: c.name, input });
          if (c.name === 'Read') {
            const p = toRel(input.file_path);
            if (p) emit({ kind: 'move', path: p });
          } else if (FORGE_TOOLS.has(c.name)) {
            const p = toRel(input.file_path ?? input.notebook_path);
            if (p) emit({ kind: 'forge', path: p, created: false });
          }
        }
        if (!sawTool && content.length > 0 && heroClass) emit({ kind: 'thinking' });
        const u = msg.usage;
        if (u && typeof u === 'object') {
          const used = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
          if (used > 0) emit({ kind: 'torch', used, max: contextLimit(model, used) });
        }
        return out;
      }

      if (obj.type === 'user' && !obj.isCompactSummary && Array.isArray(msg.content)) {
        for (const c of msg.content) {
          if (!c || c.type !== 'tool_result') continue;
          const call = pending.get(c.tool_use_id);
          if (!call) continue;
          pending.delete(c.tool_use_id);
          const text = resultText(c.content);
          if (call.name === 'Write') {
            const p = toRel(call.input.file_path);
            if (p) emit({ kind: 'forge', path: p, created: /\bcreated\b/i.test(text) });
          } else if (SCOUT_TOOLS.has(call.name)) {
            const paths = scoutPaths(text);
            if (paths.length) emit({ kind: 'scout', paths });
          } else if (call.name === 'Bash') {
            const command = typeof call.input.command === 'string' ? call.input.command : '';
            const r = obj.toolUseResult && typeof obj.toolUseResult === 'object' ? obj.toolUseResult : {};
            const output = [r.stdout, r.stderr].filter((s) => typeof s === 'string').join('\n') || text;
            const run = detectTestRun(command, output, c.is_error === true);
            // Linters often print absolute paths: make them repo-relative, and drop paths outside the repo.
            if (run) {
              const failed = run.failed.map((f) => {
                const file = f.file && !/^[A-Za-z]:|\\/.test(f.file) && toRel(f.file); // Windows paths never pass as relative
                return file ? { ...f, file } : { name: f.name };
              });
              emit({ kind: 'test_result', ...run, failed });
            } else emit({ kind: 'cast', command: programName(command) });
          }
        }
      }
      return out;
    },
  };
}
