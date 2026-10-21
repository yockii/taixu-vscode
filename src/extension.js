// Editor wiring only. All language/debug semantics remain in taixu lsp/dap.
const vscode = require('vscode');
const { LanguageClient } = require('vscode-languageclient/node');
const { spawn } = require('child_process');
const { probeServer } = require('./serverProbe');

let client;
let serverProcess;
let channel;
let lifecycle = Promise.resolve();
let generation = 0;
let closing = false;

function compilerFor() {
  return vscode.workspace.getConfiguration('taixu').get('path', '') ||
    process.env.TAIXU_PATH || 'taixu';
}

function log(line) {
  channel.appendLine(`[${new Date().toISOString()}] ${line}`);
}

function workspaceUri() {
  return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]?.uri;
}

async function stopClient(timeout = 5000) {
  const previous = client;
  const process = serverProcess;
  client = undefined;
  serverProcess = undefined;
  try {
    if (previous) await previous.dispose(timeout);
  } catch (err) {
    // In particular, languageclient rejects stop() in its startFailed state.
    log(`client shutdown: ${err.message || String(err)}`);
  }
  if (process && !process.closed) {
    process.child.stdin.end();
    await Promise.race([process.exited, new Promise(resolve => setTimeout(resolve, 500))]);
    if (!process.closed) {
      log('terminating the previous language server');
      process.child.kill();
      await Promise.race([process.exited, new Promise(resolve => setTimeout(resolve, 1500))]);
    }
    if (!process.closed) throw new Error('旧语言服务进程尚未退出，未启动新实例');
  }
  log('client stopped');
}

function restartClient() {
  const requested = ++generation;
  lifecycle = lifecycle.then(async () => {
    if (closing || requested !== generation) return;
    await stopClient();
    if (closing || requested !== generation) return;
    const command = compilerFor();
    log(`starting: ${command} lsp --stdio`);
    let next;
    const server = () => new Promise((resolve, reject) => {
      if (closing || client !== next) { reject(new Error('服务启动已被替代')); return; }
      const child = spawn(command, ['lsp', '--stdio'], { cwd: workspaceUri()?.fsPath, windowsHide: true });
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
    await next.start();
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
  const command = compilerFor();
  log(`checkServer: ${command}`);
  const result = await probeServer(command, uri?.fsPath);
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
  context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('taixu', {
    createDebugAdapterDescriptor(session) {
      return new vscode.DebugAdapterExecutable(compilerFor(), ['dap'], {
        cwd: session.configuration.cwd || session.workspaceFolder?.uri.fsPath,
      });
    },
  }));
  return restartClient();
}

async function deactivate() {
  closing = true;
  ++generation;
  await lifecycle;
  await stopClient(1000);
}

module.exports = { activate, deactivate };
