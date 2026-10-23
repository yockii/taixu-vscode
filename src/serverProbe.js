// Process/protocol health check; no language implementation.
const { spawn } = require('child_process');

async function version(command, cwd) {
  return new Promise(resolve => {
    const child = spawn(command, ['--version'], { cwd, windowsHide: true });
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => child.kill(), 10000);
    child.stdout.on('data', data => {
      size += data.length;
      if (size <= 65536) chunks.push(data);
      else child.kill();
    });
    child.stderr.resume();
    child.on('error', () => {});
    child.on('close', code => {
      clearTimeout(timer);
      resolve(code === 0 && size <= 65536 ? Buffer.concat(chunks).toString('utf8').trim() : null);
    });
  });
}

async function handshake(command, cwd, extraArgs) {
  return new Promise(resolve => {
    const child = spawn(command, ['lsp', '--stdio', ...extraArgs], { cwd, windowsHide: true });
    let buffer = Buffer.alloc(0);
    let initialized = false;
    let shutDown = false;
    let problem;
    let errorText = '';
    const timer = setTimeout(() => { problem = 'initialize/shutdown timeout'; child.kill(); }, 10000);
    function send(value) {
      const body = Buffer.from(JSON.stringify(value));
      child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
      child.stdin.write(body);
    }
    child.stdin.on('error', () => {});
    child.stdout.on('data', data => {
      buffer = Buffer.concat([buffer, data]);
      try {
        if (buffer.length > 1048576) throw new Error('oversized initialize response');
        while (true) {
          const split = buffer.indexOf('\r\n\r\n');
          if (split < 0) break;
          const match = /^Content-Length:\s*(\d+)\s*$/im.exec(buffer.subarray(0, split).toString('ascii'));
          if (!match) throw new Error('missing Content-Length');
          const length = Number(match[1]);
          if (length > 1048576) throw new Error('oversized response');
          if (buffer.length < split + 4 + length) break;
          const message = JSON.parse(buffer.subarray(split + 4, split + 4 + length).toString('utf8'));
          buffer = buffer.subarray(split + 4 + length);
          if (message.jsonrpc !== '2.0') throw new Error('invalid JSON-RPC response');
          // Requests and notifications from the server carry a method; only responses answer ours.
          if ('method' in message) continue;
          if (message.id === 1) {
            const capabilities = message.result?.capabilities;
            if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities) || message.error) {
              throw new Error('initialize refused');
            }
            initialized = true;
            send({ jsonrpc: '2.0', method: 'initialized', params: {} });
            send({ jsonrpc: '2.0', id: 2, method: 'shutdown', params: null });
          } else if (message.id === 2) {
            if (message.error || message.result !== null) throw new Error('shutdown refused');
            shutDown = true;
            send({ jsonrpc: '2.0', method: 'exit' });
            child.stdin.end();
          }
        }
      } catch (err) {
        problem = err.message;
        child.kill();
      }
    });
    child.stderr.on('data', data => { errorText = (errorText + data.toString('utf8')).slice(-4096); });
    child.on('error', err => { problem = err.message; });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ ok: initialized && shutDown && code === 0 && !problem,
        initialized, shutDown, exitCode: code, problem, stderr: errorText });
    });
    child.on('spawn', () => send({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { processId: null, rootUri: null, capabilities: {} } }));
  });
}

async function probeServer(command, cwd, extraArgs = []) {
  const actualVersion = await version(command, cwd);
  const response = await handshake(command, cwd, extraArgs);
  return { command, version: actualVersion, handshake: response, ok: !!actualVersion && response.ok };
}
module.exports = { probeServer };
