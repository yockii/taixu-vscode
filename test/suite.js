// Integration assertions through real editor providers, LanguageClient and DebugService.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const executeFile = require('util').promisify(execFile);
const vscode = require('vscode');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, passed: !!ok });
  assert.ok(ok, `${name}: ${detail || ''}`);
  console.log(`PASS ${name}`);
}
async function until(name, fn, timeout = 25000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(100);
  }
  throw new Error(`Timed out: ${name}; last=${JSON.stringify(last)}`);
}
function position(doc, text, offset = 1) {
  const index = doc.getText().indexOf(text);
  assert.ok(index >= 0, `missing ${text}`);
  return doc.positionAt(index + offset);
}
async function replace(doc, text) {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
  assert.ok(await vscode.workspace.applyEdit(edit));
}
const command = (name, ...args) => vscode.commands.executeCommand(name, ...args);

async function servers() {
  if (process.platform === 'win32') {
    const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = `[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); ` +
      `Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${process.pid}' | ` +
      `Where-Object { $_.Name -eq 'taixu.exe' } | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`;
    const { stdout: text } = await executeFile(powershell, ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true });
    const value = text.trim() ? JSON.parse(text) : [];
    return (Array.isArray(value) ? value : [value]).map(p => ({ pid: p.ProcessId, exe: p.ExecutablePath, args: p.CommandLine }));
  }
  const children = fs.readFileSync(`/proc/${process.pid}/task/${process.pid}/children`, 'utf8').trim();
  return (children ? children.split(/\s+/) : []).flatMap(pid => {
    try {
      const exe = fs.readlinkSync(`/proc/${pid}/exe`);
      return path.basename(exe) === 'taixu' ? [{ pid: Number(pid), exe,
        args: fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ') }] : [];
    } catch { return []; } // A server may exit between reading children and /proc.
  });
}

async function lifecycle({ folder, main }) {
  const config = vscode.workspace.getConfiguration('taixu');
  const original = config.get('path');
  const directory = path.join(process.env.TAIXU_TEST_STATE, '编译器 & space 🦊');
  fs.mkdirSync(directory);
  const copy = path.join(directory, process.platform === 'win32' ? 'taixu.exe' : 'taixu');
  fs.copyFileSync(original, copy);
  if (process.platform !== 'win32') fs.chmodSync(copy, 0o755);
  const before = await servers();
  check('exactly one real language server before path change', before.length === 1 && before[0].args.includes('lsp'));
  check('language server receives the workspace folder explicitly', before[0].args.includes('--workspace'));
  await config.update('path', copy, vscode.ConfigurationTarget.Workspace);
  const first = await until('new executable and old process exit', async () => {
    const current = await servers();
    if (current.length !== 1 || current[0].exe !== copy || current[0].pid === before[0].pid) return false;
    const symbols = await command('vscode.executeDocumentSymbolProvider', main);
    return symbols && symbols.some(s => s.name === 'main') && current[0];
  });
  check('changing taixu.path replaces the actual server process', true);
  await config.update('path', original, vscode.ConfigurationTarget.Workspace);
  await config.update('path', copy, vscode.ConfigurationTarget.Workspace);
  await until('rapid changes settle on the latest executable', async () => {
    const current = await servers();
    if (current.length !== 1 || current[0].exe !== copy || current[0].pid === first.pid) return false;
    const symbols = await command('vscode.executeDocumentSymbolProvider', main);
    return symbols && symbols.some(s => s.name === 'main');
  });
  const symbols = await command('vscode.executeDocumentSymbolProvider', main);
  check('rapid path changes retain working providers without duplicate servers', symbols.some(s => s.name === 'main'));
  const health = await command('taixu.checkServer');
  check('Check Server parses initialize and completes shutdown/exit', health.ok && health.command === copy &&
    health.handshake.initialized && health.handshake.shutDown && health.handshake.exitCode === 0);
  check('Check Server leaves only the real language server', (await servers()).length === 1);
  const missing = path.join(directory, 'missing-taixu');
  await config.update('path', missing, vscode.ConfigurationTarget.Workspace);
  await until('invalid configuration stops the previous server', async () => (await servers()).length === 0);
  const failedHealth = await command('taixu.checkServer');
  check('missing executable is reported as a failed health check', !failedHealth.ok &&
    failedHealth.version === null && /ENOENT/.test(failedHealth.handshake.problem));
  await config.update('path', copy, vscode.ConfigurationTarget.Workspace);
  await until('restore a valid compiler after start failure', async () => {
    const current = await servers();
    if (current.length !== 1 || current[0].exe !== copy) return false;
    const symbols = await command('vscode.executeDocumentSymbolProvider', main);
    return symbols && symbols.some(s => s.name === 'main');
  });
  check('language service recovers after correcting a missing executable', true);
  // A command name must never resolve to an executable planted in the workspace (spawn cwd).
  const planted = path.join(folder.uri.fsPath, process.platform === 'win32' ? 'taixu.exe' : 'taixu');
  fs.copyFileSync(copy, planted);
  if (process.platform !== 'win32') fs.chmodSync(planted, 0o755);
  try {
    await config.update('path', 'taixu', vscode.ConfigurationTarget.Workspace);
    const named = await command('taixu.checkServer');
    const settle = Date.now() + 5000;
    await until('restart with a command name', async () => (await servers()).length > 0 || Date.now() > settle);
    check('command name is not resolved from the workspace directory',
      (named.command === null ? /PATH/.test(named.problem) : path.isAbsolute(named.command) && named.command !== planted) &&
      (await servers()).every(p => path.resolve(p.exe) !== path.resolve(planted)));
    await config.update('path', `.${path.sep}taixu`, vscode.ConfigurationTarget.Workspace);
    const relative = await command('taixu.checkServer');
    check('relative taixu.path is rejected', !relative.ok && relative.command === null && /绝对路径/.test(relative.problem));
  } finally {
    await config.update('path', copy, vscode.ConfigurationTarget.Workspace);
    await until('restore the valid compiler after name checks', async () => {
      const current = await servers();
      return current.length === 1 && current[0].exe === copy;
    });
    fs.rmSync(planted, { force: true });
  }
  // Host-share mount types are machine-scoped: a workspace (e.g. a cloned repo's .vscode/settings.json) cannot opt in.
  let refused = false;
  try {
    await config.update('allowMountTypes', ['9p'], vscode.ConfigurationTarget.Workspace);
  } catch {
    refused = true;
  }
  check('workspace settings cannot enable host-share mounts',
    refused && !vscode.workspace.getConfiguration('taixu').inspect('allowMountTypes').workspaceValue);
  const plain = (await servers())[0];
  await config.update('allowMountTypes', ['9p'], vscode.ConfigurationTarget.Global);
  try {
    await until('user opt-in restarts the server with --allow-mount-type', async () => {
      const current = await servers();
      return current.length === 1 && current[0].pid !== plain.pid && current[0].args.includes('--allow-mount-type 9p');
    });
    check('user-level host-share opt-in reaches the language server', true);
  } finally {
    await config.update('allowMountTypes', undefined, vscode.ConfigurationTarget.Global);
    await until('opt-in removed again', async () => {
      const current = await servers();
      return current.length === 1 && !current[0].args.includes('--allow-mount-type');
    });
  }
}

async function editor() {
  const folder = vscode.workspace.workspaceFolders[0];
  const main = vscode.Uri.joinPath(folder.uri, 'main.tx');
  const math = vscode.Uri.joinPath(folder.uri, 'math.tx');
  const doc = await vscode.workspace.openTextDocument(main);
  await vscode.window.showTextDocument(doc);
  check('opening .tx activates the actual extension', doc.languageId === 'taixu');
  const symbols = await until('document symbols', async () => {
    const value = await command('vscode.executeDocumentSymbolProvider', main);
    return value && value.some(s => s.name === 'main') && value;
  });
  check('document symbols', symbols.length > 0);
  const original = doc.getText();
  await replace(doc, original.replace('sum(19, 23)', 'missingName(19, 23)'));
  await until('unsaved diagnostics', () => vscode.languages.getDiagnostics(main).some(d => d.severity === 0));
  check('unsaved edit publishes a semantic error', true);
  await replace(doc, original);
  await until('diagnostics clear', () => !vscode.languages.getDiagnostics(main).some(d => d.severity === 0));
  check('fixing the unsaved edit clears diagnostics', true);

  const call = position(doc, 'sum(19');
  const definitions = await command('vscode.executeDefinitionProvider', main, call);
  check('definition after non-BMP text crosses files', definitions.some(d =>
    (d.targetUri || d.uri).fsPath === math.fsPath));
  const refs = await command('vscode.executeReferenceProvider', main, call);
  check('references include import, declaration and call', refs.length >= 3);
  const hover = await command('vscode.executeHoverProvider', main, call);
  check('hover contains declared parameter types', hover.some(h => h.contents.some(c =>
    /int/.test(typeof c === 'string' ? c : c.value))));
  const signatures = await command('vscode.executeSignatureHelpProvider', main, position(doc, 'sum(19, 23)', 8), '(');
  check('signature help selects second parameter', signatures && signatures.signatures.length > 0 && signatures.activeParameter === 1);
  const completions = await command('vscode.executeCompletionItemProvider', main, position(doc, 'print(marker)', 0));
  check('completion contains visible locals', completions.items.some(i =>
    (typeof i.label === 'string' ? i.label : i.label.label) === 'total'));
  const tokens = await command('vscode.provideDocumentSemanticTokens', main);
  check('semantic highlighting uses actual provider', tokens && tokens.data.length > 0);

  const rename = await command('vscode.executeDocumentRenameProvider', main, call, 'combine');
  check('rename produces edits in both files', rename && rename.entries().length === 2);
  assert.ok(await vscode.workspace.applyEdit(rename));
  check('rename changes call and import in editor buffers', doc.getText().includes('combine(19, 23)') &&
    doc.getText().includes('import { combine }'));
  const mathDoc = await vscode.workspace.openTextDocument(math);
  check('rename changes the declaration in the other editor buffer', mathDoc.getText().includes('function combine('));
  assert.ok(await mathDoc.save());
  assert.ok(await doc.save());
  await vscode.workspace.saveAll(false);
  check('renamed files are saved to disk', fs.readFileSync(math.fsPath, 'utf8').includes('function combine('));

  await replace(doc, doc.getText().replace('const total = combine(19, 23);', 'const total=combine(19,23);'));
  const edits = await command('vscode.executeFormatDocumentProvider', main, { tabSize: 4, insertSpaces: true });
  const formatting = new vscode.WorkspaceEdit();
  formatting.set(main, edits);
  assert.ok(await vscode.workspace.applyEdit(formatting));
  check('formatting changes the real editor buffer', doc.getText().includes('const total = combine(19, 23);'));
  await doc.save();
  return { folder, main, doc };
}

async function debug({ folder, main, doc }) {
  const messages = [];
  const requests = [];
  const disposables = [];
  let session;
  let ended = false;
  disposables.push(vscode.debug.registerDebugAdapterTrackerFactory('taixu', {
    createDebugAdapterTracker() {
      return { onDidSendMessage(message) { messages.push(message); },
        onWillReceiveMessage(message) { requests.push(message); } };
    },
  }));
  disposables.push(vscode.debug.onDidTerminateDebugSession(s => { if (s === session) ended = true; }));
  const line = position(doc, 'print(marker)', 0).line;
  const bp = new vscode.SourceBreakpoint(new vscode.Location(main, new vscode.Position(line, 0)));
  vscode.debug.addBreakpoints([bp]);
  try {
    check('DAP starts from taixu.path with no TAIXU_PATH', await vscode.debug.startDebugging(folder, {
      type: 'taixu', request: 'launch', name: 'Native editor acceptance', program: main.fsPath,
      cwd: folder.uri.fsPath,
    }));
    session = vscode.debug.activeDebugSession;
    const stop = await until('breakpoint in real DebugService', () =>
      messages.find(m => m.type === 'event' && m.event === 'stopped'));
    check('source breakpoint stops native program', stop.body.reason === 'breakpoint');
    check('real VS Code recognizes initialize capabilities and sends configurationDone',
      messages.some(m => m.command === 'initialize' && m.body.supportsConfigurationDoneRequest === true &&
        !('capabilities' in m.body)) && requests.some(m => m.command === 'configurationDone'));
    const stack = await session.customRequest('stackTrace', { threadId: stop.body.threadId });
    const frame = stack.stackFrames[0];
    check('stack points to the source breakpoint', frame.line === line + 1 && /main/.test(frame.name));
    const scopes = await session.customRequest('scopes', { frameId: frame.id });
    const local = scopes.scopes.find(s => s.name === '局部变量');
    check('named locals scope is exposed', !!local);
    const values = await session.customRequest('variables', { variablesReference: local.variablesReference });
    check('variable values include total=42', values.variables.some(v => v.name === 'total' && v.value === '42'));
    check('Unicode local string is intact', values.variables.some(v => v.name === 'marker' && v.value.includes('🦊中文')));
    const count = messages.filter(m => m.event === 'stopped').length;
    await session.customRequest('next', { threadId: stop.body.threadId });
    await until('single step', () => messages.filter(m => m.event === 'stopped').length > count);
    check('single step produces another stopped event', true);
    vscode.debug.removeBreakpoints([bp]);
    await session.customRequest('continue', { threadId: stop.body.threadId });
    await until('normal debug termination', () => ended);
    const output = messages.filter(m => m.event === 'output').map(m => m.body.output).join('');
    check('debug console captures Unicode and program result', output.includes('🦊中文') && output.includes('42'));
    check('native debug program exits zero', messages.some(m => m.event === 'exited' && m.body.exitCode === 0));
  } finally {
    fs.writeFileSync(path.join(process.env.TAIXU_TEST_STATE, 'dap.json'), JSON.stringify({ requests, messages }, null, 2) + '\n');
    vscode.debug.removeBreakpoints([bp]);
    if (session && !ended) await vscode.debug.stopDebugging(session);
    for (const d of disposables) d.dispose();
  }
}

async function run() {
  const report = { vscode: vscode.version, platform: process.platform, checks };
  try {
    const context = await editor();
    await lifecycle(context);
    await debug(context);
    // Let VS Code itself invoke deactivate. The outer runner verifies these
    // actual child PIDs disappear after the editor/extension host exits.
    report.processesBeforeShutdown = await servers();
    report.passed = true;
  } catch (err) {
    report.passed = false;
    report.error = err.stack;
    throw err;
  } finally {
    fs.writeFileSync(path.join(process.env.TAIXU_TEST_STATE, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    await command('workbench.action.closeAllEditors');
  }
}
module.exports = { run };
