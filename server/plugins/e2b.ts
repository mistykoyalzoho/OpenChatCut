// Server-side proxy to an e2b cloud sandbox. Holds E2B_API_KEY (never shipped to the
// browser) and exposes POST /e2b/run: write optional input files, run one shell command,
// read optional output files, return stdout/stderr/exitCode. This is our own sandbox for
// running skill-shipped scripts (ffmpeg / node / python) — the portable stand-in for the
// native Agent Skills code-execution container, which our relay can't reach. The sandbox
// cannot touch the editor; results come back and the agent applies them via local tools.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { Sandbox } from '@e2b/code-interpreter';

import { isSafeUploadName, resolveUploadFile, uploadDir } from '../media-dir.ts';
import { PRODUCT_ASSETS_DIR, resolveProductAsset } from '../product-assets.ts';
import { safePublicFetch } from '../safe-public-fetch.ts';


const MAX_FETCH = 200_000_000; // cap bytes pulled into the sandbox
let alphaSeq = 0; // filename disambiguator for transcoded outputs

// Resolve a file's bytes to write into the sandbox: inline `content`, a local
// product asset (`/fonts/...` under assets/), a user upload (`/media/uploads/...`),
// or a public http(s) URL. Path-traversal guarded.
export async function resolveE2bFileBytes(file: E2bFile): Promise<string | ArrayBuffer> {
  if (file.content !== undefined) return file.content;
  const url = file.url;
  if (!url) throw new Error(`file ${file.path} needs content or url`);
  if (url.startsWith('/')) {
    const clean = url.replace(/^\/+/, '');
    // User uploads (may live outside public/ via MEDIA_DIR)
    if (clean.startsWith('media/uploads/')) {
      const name = clean.slice('media/uploads/'.length);
      if (!isSafeUploadName(name)) throw new Error(`illegal local path ${url}`);
      const hit = resolveUploadFile(name);
      if (!hit) throw new Error(`local media not found: ${name}`);
      const data = await readFile(hit);
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    }
    // Product-bundled static files under assets/ (same URL as when they lived in public/)
    const product = resolveProductAsset('/' + clean);
    if (product) {
      const data = await readFile(product);
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    }
    throw new Error(`local path not found: ${url} (looked in uploads + ${PRODUCT_ASSETS_DIR})`);
  }
  if (!/^https?:\/\//.test(url)) throw new Error(`unsupported url ${url}`);
  const response = await safePublicFetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`fetch ${url} failed (${response.status})`);
  const buf = await response.arrayBuffer();
  if (buf.byteLength > MAX_FETCH) throw new Error(`fetched file too large (${buf.byteLength} bytes)`);
  return buf;
}

interface E2bOptions {
  apiKey: string;
  /** e2b template id/name; omit → SDK default (code-interpreter, no ffmpeg). Set to a
   *  custom template (e.g. one with ffmpeg baked in) via E2B_TEMPLATE in .env.local. */
  template?: string;
  /** Run commands directly on this Mac when no E2B key is set (LOCAL_SHELL != '0'). */
  localShell?: boolean;
}

interface E2bFile {
  path: string;
  content?: string; // inline text content
  url?: string; // OR fetch bytes: /media/... (local public dir) or http(s)://
}

interface E2bRequest {
  command: string;
  files?: E2bFile[];
  outputs?: string[];
  timeoutMs?: number;
  /** Local backend only: working directory (absolute or ~/...). Default: a fresh temp dir. */
  cwd?: string;
}

const MAX_BODY = 25_000_000; // allow small media files written into the sandbox
const MAX_TIMEOUT = 300_000;

async function readJson(req: IncomingMessage): Promise<E2bRequest> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_BODY) throw new Error('request body too large');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as E2bRequest;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

// e2b throws CommandExitError on a non-zero exit — that's a normal result (the command
// ran and failed), so pull stdout/stderr/exitCode off it rather than treating it as an
// infra error. Re-throw anything without an exitCode (connection/sandbox failure).
function asCommandResult(error: unknown): { stdout: string; stderr: string; exitCode: number } {
  const e = error as { stdout?: string; stderr?: string; exitCode?: number };
  if (typeof e.exitCode === 'number') return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.exitCode };
  throw error;
}

const LOCAL_MAX_TIMEOUT = 1_800_000;
const LOCAL_MAX_STREAM = 4_000_000;

function expandHome(path: string): string {
  return path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}

// Local backend: the same /e2b/run contract, executed by the user's own login shell on
// this Mac with the app user's full permissions. Used when no E2B key is configured and
// LOCAL_SHELL is not '0'. Relative file/output paths resolve against the working dir.
export async function runLocalCommand(input: E2bRequest): Promise<{
  stdout: string; stderr: string; exitCode: number; outputs: Record<string, string>; backend: 'local'; cwd: string;
}> {
  const command = String(input.command ?? '').trim();
  if (!command) throw new Error('command is required');
  const cwd = input.cwd?.trim()
    ? resolve(expandHome(input.cwd.trim()))
    : await mkdtemp(join(tmpdir(), 'openchatcut-run-'));
  await mkdir(cwd, { recursive: true });
  const at = (path: string) => (isAbsolute(expandHome(path)) ? expandHome(path) : join(cwd, path));
  for (const file of input.files ?? []) {
    const target = at(file.path);
    await mkdir(dirname(target), { recursive: true });
    const bytes = await resolveE2bFileBytes(file);
    await writeFile(target, typeof bytes === 'string' ? bytes : Buffer.from(bytes));
  }
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 300_000, 1_000), LOCAL_MAX_TIMEOUT);
  const shell = process.env.SHELL && isAbsolute(process.env.SHELL) ? process.env.SHELL : '/bin/zsh';
  const path = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin']
    .join(':');
  const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((done, fail) => {
    const child = spawn(shell, ['-lc', command], {
      cwd, env: { ...process.env, PATH: path }, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const take = (prev: string, chunk: Buffer) => (prev.length >= LOCAL_MAX_STREAM ? prev : prev + chunk.toString('utf8'));
    child.stdout.on('data', (c: Buffer) => { stdout = take(stdout, c); });
    child.stderr.on('data', (c: Buffer) => { stderr = take(stderr, c); });
    const timer = setTimeout(() => {
      stderr += `\n[local] timed out after ${timeoutMs} ms; process group killed`;
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); fail(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      done({ stdout, stderr, exitCode: typeof code === 'number' ? code : signal ? 137 : 1 });
    });
  });
  const outputs: Record<string, string> = {};
  for (const out of input.outputs ?? []) {
    try { outputs[out] = await readFile(at(out), 'utf8'); } catch { outputs[out] = ''; }
  }
  return { ...result, outputs, backend: 'local', cwd };
}

function createSandbox(options: E2bOptions, timeoutMs: number): Promise<Sandbox> {
  const createOpts = { apiKey: options.apiKey, timeoutMs: Math.min(timeoutMs, MAX_TIMEOUT) };
  return options.template ? Sandbox.create(options.template, createOpts) : Sandbox.create(createOpts);
}

// Body of POST /e2b/transcode-alpha: { source } is a /media/... path or public URL.
interface TranscodeRequest { source?: string; timeoutMs?: number }

export function e2bPlugin(options: E2bOptions): Plugin {
  return {
    name: 'openchatcut-e2b',
    configureServer(server) {
      server.middlewares.use('/e2b/run', async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed — use POST' }); return; }
        let sandbox: Sandbox | undefined;
        try {
          if (!options.apiKey && options.localShell) {
            sendJson(res, 200, await runLocalCommand(await readJson(req)));
            return;
          }
          if (!options.apiKey) throw new Error('e2b sandbox is not configured. Set E2B_API_KEY in .env.local, or leave LOCAL_SHELL unset to run on this Mac.');
          const input = await readJson(req);
          const command = String(input.command ?? '').trim();
          if (!command) throw new Error('command is required');

          sandbox = await createSandbox(options, input.timeoutMs ?? 120_000);
          for (const file of input.files ?? []) {
            await sandbox.files.write(file.path, await resolveE2bFileBytes(file));
          }

          let result: { stdout: string; stderr: string; exitCode: number };
          try {
            const r = await sandbox.commands.run(command);
            result = { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode ?? 0 };
          } catch (error) {
            result = asCommandResult(error);
          }

          const outputs: Record<string, string> = {};
          for (const path of input.outputs ?? []) {
            try { outputs[path] = await sandbox.files.read(path); } catch { outputs[path] = ''; }
          }

          sendJson(res, 200, { ...result, outputs });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          server.config.logger.error(`[e2b] ${message}`);
          sendJson(res, 400, { error: message });
        } finally {
          if (sandbox) { try { await sandbox.kill(); } catch { /* sandbox already gone */ } }
        }
      });

      // POST /e2b/transcode-alpha { source } — transcode a rendered clip (a transparent
      // ProRes .mov under /media, or a public URL) to a VP9 alpha WebM using the sandbox's
      // ffmpeg (this env's local ffmpeg can't encode alpha webm — see clipExport.ts). The
      // webm is read back as BYTES (binary-safe) and written to media/uploads; returns its
      // path. This is the "bake to video = bake to an alpha webm" step that local ffmpeg can't do.
      server.middlewares.use('/e2b/transcode-alpha', async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed — use POST' }); return; }
        let sandbox: Sandbox | undefined;
        try {
          if (!options.apiKey) throw new Error('e2b sandbox is not configured. Set E2B_API_KEY in .env.local.');
          const input = (await readJson(req)) as unknown as TranscodeRequest;
          const source = String(input.source ?? '').trim();
          if (!source) throw new Error('source is required');
          const bytes = await resolveE2bFileBytes({ path: 'in.media', url: source });
          if (typeof bytes === 'string') throw new Error('source must be a media file (path or url), not inline text');

          sandbox = await createSandbox(options, input.timeoutMs ?? 240_000);
          await sandbox.files.write('in.media', bytes);
          // -auto-alt-ref 0 is required for VP9 alpha (alt-ref frames drop the alpha plane);
          // -metadata alpha_mode=1 tags the WebM so players read the separate alpha stream
          // (VP9 alpha rides a side stream — the main pix_fmt stays yuv420p, which is normal).
          const cmd = 'ffmpeg -y -i in.media -an -c:v libvpx-vp9 -pix_fmt yuva420p -metadata:s:v:0 alpha_mode=1 -auto-alt-ref 0 -b:v 3M -deadline good -cpu-used 4 -row-mt 1 out.webm';
          try {
            await sandbox.commands.run(cmd, { timeoutMs: Math.min(input.timeoutMs ?? 240_000, MAX_TIMEOUT) });
          } catch (error) {
            const r = asCommandResult(error); // non-zero exit → surface ffmpeg's stderr
            throw new Error(`ffmpeg vp9-alpha failed (exit ${r.exitCode}): ${r.stderr.slice(-400)}`);
          }
          const webm = await sandbox.files.read('out.webm', { format: 'bytes' });
          if (!webm || webm.byteLength === 0) throw new Error('transcode produced an empty file');

          const fname = `mgalpha_${Date.now().toString(36)}_${alphaSeq++}.webm`;
          const dir = uploadDir();
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, fname), Buffer.from(webm));
          sendJson(res, 200, { ok: true, path: `/media/uploads/${fname}`, bytes: webm.byteLength, transparent: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          server.config.logger.error(`[e2b transcode-alpha] ${message}`);
          sendJson(res, 400, { error: message });
        } finally {
          if (sandbox) { try { await sandbox.kill(); } catch { /* sandbox already gone */ } }
        }
      });
    },
  };
}
