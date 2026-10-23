// Editor wiring only. All language/debug semantics remain in taixu lsp/dap.
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { LanguageClient } = require('vscode-languageclient/node');
const { spawn } = require('child_process');
const { probeServer } = require('./serverProbe');

const START_TIMEOUT_MS = 30000;
const DEACTIVATE_WAIT_MS = 5000;

let client;
let serverProcess;
let channel;
let lifecycle = Promise.resolve();
let generation = 0;
let closing = false;

// A bare command name is looked up on PATH here, never in the working directory: on Windows,
// libuv searches the spawn cwd (the workspace) before PATH, so a planted taixu.exe would run.
// Relative PATH entries are skipped for the same reason.
function findOnPath(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(d => d && path.isAbsolute(d));
  const exts = process.platform === 'win32' && !path.extname(name) ? ['.exe', '.com'] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        if (process.platform !== 'win32') fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Not here; keep searching.
      }
    }
  }
  return null;
}

// The executable for taixu lsp/dap as an absolute path: taixu.path, then TAIXU_PATH, then taixu on PATH.
function compilerFor() {
  const configured = vscode.workspace.getConfiguration('taixu').get('path', '') || process.env.TAIXU_PATH || '';
  if (configured && path.isAbsolute(configured)) return configured;
  if (configured.includes('/') || configured.includes('\\')) {
    throw new Error(`taixu.path 须为绝对路径或命令名：${configured}`);
  }
  const name = configured || 'taixu';
  const found = findOnPath(name);
  if (!found) throw new Error(`在 PATH 中找不到 ${name}（不在工作区目录里查找）`);
  return found;
}

function log(line) {
  channel.appendLine(`[${new Date().toISOString()}] ${line}`);
}

function workspaceUri() {
  return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]?.uri;
}

// Every local workspace folder is authorised explicitly (taixu lsp only defaults to its cwd).
function workspaceArgs() {
  return (vscode.workspace.workspaceFolders || [])
    .filter(folder => folder.uri.scheme === 'file')
    .flatMap(folder => ['--workspace', folder.uri.fsPath]);
}

function within(promise, ms, what) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}超时（${ms / 1000} s）`)), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

function settled(promise, ms) {
  return Promise.race([promise, new Promise(resolve => setTimeout(resolve, ms))]);
}

async function stopClient(timeout = 5000) {
  const previous = client;
  client = undefined;
  try {
    if (previous) await previous.dispose(timeout);
  } catch (err) {
    // In particular, languageclient rejects stop() in its startFailed state.
    log(`client shutdown: ${err.message || String(err)}`);
  }
  const owned = serverProcess;
  if (owned && !owned.closed) {
    owned.child.stdin.end();
    await settled(owned.exited, 500);
    if (!owned.closed) {
      log('terminating the previous language server');
      owned.child.kill();
      await settled(owned.exited, 1500);
    }
    if (!owned.closed && process.platform !== 'win32') {
      owned.child.kill('SIGKILL');
      await settled(owned.exited, 1500);
    }
    // Keep tracking a survivor so the next stop tries again instead of starting a duplicate.
    if (!owned.closed) throw new Error('旧语言服务进程尚未退出，未启动新实例');
  }
  if (serverProcess === owned) serverProcess = undefined;
  log('client stopped');
}

function restartClient() {
  const requested = ++generation;
  lifecycle = lifecycle.then(async () => {
    if (closing || requested !== generation) return;
    await stopClient();
    if (closing || requested !== generation) return;
    const command = compilerFor();
    const args = ['lsp', '--stdio', ...workspaceArgs()];
    log(`starting: ${command} ${args.join(' ')}`);
    let next;
    const server = () => new Promise((resolve, reject) => {
      if (closing || client !== next) { reject(new Error('服务启动已被替代')); return; }
      const child = spawn(command, args, { cwd: workspaceUri()?.fsPath, windowsHide: true });
      child.stdin.on('error', () => {}); // Spawn failures can close stdin before JSON-RPC attaches.
      const owned = { child, closed: false };
      owned.exited = new Promise(done => child.once('close', () => { owned.closed = true; done(); }));
      serverProcess = owned;
      child.once('error', reject);
      child.once('spawn', () => resolve(child));
    });
    next = new LanguageClient('taixu', 'Taixu Language Server', server, {
      documentSelector: [{ language: 'taixu', scheme: 'file' }],
      outputChannel: channel,
    });
    client = next;
    // A server that never answers initialize must not hold up later restarts or deactivation.
    await within(next.start(), START_TIMEOUT_MS, '语言服务启动');
    log('client started');
  }).catch(err => {
    const message = err.message || String(err);
    log(`client start/stop failed: ${message}`);
    if (!closing) vscode.window.showErrorMessage(
      `taixu LSP 启动失败：${message}。运行「Taixu: Check Server」查看详情。`
    );
  });
  return lifecycle;
}

async function checkServer() {
  const uri = workspaceUri();
  let command;
  try {
    command = compilerFor();
  } catch (err) {
    const result = { command: null, version: null, ok: false, problem: err.message };
    log(`checkServer: ${JSON.stringify(result)}`);
    vscode.window.showErrorMessage('taixu 服务器自检失败，详情见「Taixu LSP」输出通道。');
    channel.show(true);
    return result;
  }
  log(`checkServer: ${command}`);
  const result = await probeServer(command, uri?.fsPath, workspaceArgs());
  log(`checkServer: ${JSON.stringify(result)}`);
  if (result.ok) {
    vscode.window.showInformationMessage(`taixu 服务器自检通过（${result.version}）`);
  } else {
    vscode.window.showErrorMessage('taixu 服务器自检失败，详情见「Taixu LSP」输出通道。');
  }
  channel.show(true);
  return result;
}

function activate(context) {
  closing = false;
  channel = vscode.window.createOutputChannel('Taixu LSP');
  context.subscriptions.push(channel);
  context.subscriptions.push(vscode.commands.registerCommand('taixu.checkServer', checkServer));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('taixu.path')) restartClient();
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => restartClient()));
  context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('taixu', {
    createDebugAdapterDescriptor(session) {
      // taixu dap resolves a relative launch "cwd" against its own cwd, so that must be the folder.
      const folder = session.workspaceFolder?.uri;
      return new vscode.DebugAdapterExecutable(compilerFor(), ['dap'], {
        cwd: folder?.scheme === 'file' ? folder.fsPath : undefined,
      });
    },
  }));
  // Activation does not wait for the language server; failures are reported by restartClient.
  restartClient();
}

async function deactivate() {
  closing = true;
  ++generation;
  await settled(lifecycle, DEACTIVATE_WAIT_MS);
  await stopClient(1000);
}

module.exports = { activate, deactivate };
