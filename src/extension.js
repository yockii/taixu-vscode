// taixu-vscode LSP 客户端。
//
// **红线：插件端零语言实现副本**——诊断/格式化/补全/定义一切语义能力走
// `taixu lsp --stdio` 子进程，本插件只做编辑器集成，不存在第二套语言实现。
// 本文件只做编辑器接线：spawn 服务器 + 转发协议 + 配置读取。纯 JS 零编译步骤。
//
// 可观测性：输出通道（Taixu LSP）记录启停/配置/错误详情；`taixu.checkServer`
// 命令做进程级自检（--version ＋ Content-Length 帧 initialize 握手探针），
// 便于在 LSP 启动失败时快速定位是路径问题还是服务器问题。

const vscode = require('vscode');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');
const { spawn } = require('child_process');

let client = null;
let channel = null;

function log(line) {
  if (!channel) channel = vscode.window.createOutputChannel('Taixu LSP');
  channel.appendLine(`[${new Date().toISOString()}] ${line}`);
}

// 进程级自检：--version ＋ 帧 initialize 握手（10s 上限；结论写入输出通道）。
async function checkServer() {
  const config = vscode.workspace.getConfiguration('taixu');
  const command = config.get('path', 'taixu');
  log(`checkServer: command=${command}`);
  const problems = [];

  const version = await new Promise((resolve) => {
    const p = spawn(command, ['--version']);
    let out = '';
    const t = setTimeout(() => { p.kill(); resolve(null); }, 10000);
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', (e) => { clearTimeout(t); problems.push(`spawn 失败：${e.message}`); resolve(null); });
    p.on('close', (code) => { clearTimeout(t); resolve(code === 0 ? out.trim() : null); if (code !== 0) problems.push(`--version 退出码 ${code}`); });
  });
  log(`checkServer: --version => ${version === null ? '失败' : version.split('\n')[0]}`);

  const handshake = await new Promise((resolve) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } });
    const p = spawn(command, ['lsp', '--stdio']);
    let out = '';
    const t = setTimeout(() => { p.kill(); resolve(false); }, 10000);
    p.stdin.on('error', () => {});
    p.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    p.stdout.on('data', (d) => {
      out += d;
      if (out.includes('"capabilities"')) { clearTimeout(t); p.kill(); resolve(true); }
    });
    p.on('error', (e) => { clearTimeout(t); problems.push(`spawn lsp 失败：${e.message}`); resolve(false); });
    p.on('close', () => { clearTimeout(t); resolve(out.includes('"capabilities"')); });
  });
  log(`checkServer: initialize 握手 => ${handshake ? '通过（capabilities 应答）' : '失败（无应答——旧二进制旗标缺陷或路径不可执行，见输出通道）'}`);

  if (version !== null && handshake) {
    vscode.window.showInformationMessage(`taixu 服务器自检通过（${version.split('\n')[0]}）`);
  } else {
    vscode.window.showErrorMessage(`taixu 服务器自检失败——详情见「Taixu LSP」输出通道（命令面板 → Taixu: Check Server 可重跑）`);
  }
  channel.show();
}

function activate(context) {
  const config = vscode.workspace.getConfiguration('taixu');
  const command = config.get('path', 'taixu');
  log(`activate: taixu.path=${command}`);

  const serverOptions = {
    run: { command, args: ['lsp', '--stdio'], transport: TransportKind.stdio },
    debug: { command, args: ['lsp', '--stdio'], transport: TransportKind.stdio },
  };

  const clientOptions = {
    documentSelector: [{ language: 'taixu', scheme: 'file' }],
    synchronize: {
      // taixu.path 变更 → 重启服务器
      configurationSection: 'taixu',
    },
    outputChannel: channel || (channel = vscode.window.createOutputChannel('Taixu LSP')),
  };

  client = new LanguageClient('taixu', 'Taixu Language Server', serverOptions, clientOptions);
  context.subscriptions.push(client);
  context.subscriptions.push(vscode.commands.registerCommand('taixu.checkServer', checkServer));

  client.start().then(
    () => log('client started'),
    (err) => {
      log(`client start 失败：${err && err.message ? err.message : String(err)}`);
      vscode.window.showErrorMessage(
        `taixu LSP 启动失败（${command} 不可执行或握手无应答？）: ${err.message} —— 可运行命令「Taixu: Check Server」定位，详情见「Taixu LSP」输出通道`
      );
    }
  );
}

function deactivate() {
  if (client) {
    return client.stop();
  }
  return undefined;
}

module.exports = { activate, deactivate };
