// Run the real VS Code extension host in an isolated profile/workspace.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const extension = process.env.TAIXU_TEST_EXTENSION || root;
const code = process.env.VSCODE_EXECUTABLE;
const compiler = process.env.TAIXU_TEST_COMPILER;
if (!code || !compiler) {
  console.error('Set VSCODE_EXECUTABLE and TAIXU_TEST_COMPILER to absolute executable paths.');
  process.exit(2);
}
const runs = path.join(root, '.vscode-test');
fs.mkdirSync(runs, { recursive: true });
// Keep only the two most recent earlier runs (profiles are large); this run's directory is new.
fs.readdirSync(runs).filter(name => name.startsWith('run-'))
  .map(name => ({ name, time: fs.statSync(path.join(runs, name)).mtimeMs }))
  .sort((a, b) => b.time - a.time).slice(2)
  .forEach(old => fs.rmSync(path.join(runs, old.name), { recursive: true, force: true }));
const state = fs.mkdtempSync(path.join(runs, 'run-'));
const workspace = path.join(state, '工程 中文 & space');
fs.mkdirSync(path.join(workspace, '.vscode'), { recursive: true });
const settings = {
  'taixu.path': path.resolve(compiler),
  'security.workspace.trust.enabled': false,
  'workbench.startupEditor': 'none',
  'update.mode': 'none',
  'telemetry.telemetryLevel': 'off',
  'extensions.autoCheckUpdates': false,
  'extensions.autoUpdate': false,
};
fs.writeFileSync(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
fs.mkdirSync(path.join(state, 'profile', 'User'), { recursive: true });
fs.writeFileSync(path.join(state, 'profile', 'User', 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
fs.writeFileSync(path.join(workspace, 'math.tx'),
  '// Add two integers.\nexport function sum(a: int, b: int): int {\n    return a + b;\n}\n');
fs.writeFileSync(path.join(workspace, 'main.tx'),
  'import { sum } from "./math";\n\nexport function main(args: []string): int {\n' +
  '    const marker = "🦊中文"; const total = sum(19, 23);\n' +
  '    print(marker);\n    print(toStr(total));\n    return 0;\n}\n');
const env = { ...process.env, TAIXU_TEST_STATE: state };
// Deliberately prove that the configured executable works without the old DAP env override.
delete env.TAIXU_PATH;
delete env.ELECTRON_RUN_AS_NODE;
delete env.VSCODE_IPC_HOOK_CLI;
const child = spawn(code, [
  ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
  '--new-window', '--disable-extensions', '--disable-workspace-trust',
  '--skip-welcome', '--skip-release-notes',
  '--user-data-dir', path.join(state, 'profile'),
  '--extensions-dir', path.join(state, 'extensions'),
  `--extensionDevelopmentPath=${extension}`, `--extensionTestsPath=${path.join(__dirname, 'suite.js')}`,
  workspace,
], { env, stdio: 'inherit' });
const timer = setTimeout(() => {
  console.error('Extension host exceeded 240 seconds.');
  child.kill();
  process.exitCode = 1;
}, 240000);
child.on('error', err => { clearTimeout(timer); console.error(err); process.exitCode = 1; });
child.on('exit', async code => {
  clearTimeout(timer);
  const reportPath = path.join(state, 'report.json');
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const alive = pid => {
      try { process.kill(pid, 0); return true; }
      catch (err) { if (err.code === 'ESRCH') return false; throw err; }
    };
    const children = report.processesBeforeShutdown || [];
    const end = Date.now() + 10000;
    while (children.some(p => alive(p.pid)) && Date.now() < end) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const clean = children.length > 0 && children.every(p => !alive(p.pid));
    report.checks.push({ name: 'real editor shutdown leaves no server child processes', passed: clean });
    report.passed = report.passed && clean && code === 0;
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`${clean ? 'PASS' : 'FAIL'} real editor shutdown leaves no server child processes`);
    process.exitCode = process.exitCode || (report.passed ? 0 : 1);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
  console.log(`Editor report: ${reportPath}`);
});
