import net from 'node:net';

const socketPath = process.env.KBV_MCP_BRIDGE_SOCKET_PATH?.trim();

if (!socketPath) {
  process.stderr.write('KBV_MCP_BRIDGE_SOCKET_PATH is required\n');
  process.exit(1);
}

const socket = net.createConnection(socketPath);

socket.on('connect', () => {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    socket.write(chunk);
  });
});

socket.on('data', (chunk: Buffer | string) => {
  process.stdout.write(chunk.toString());
});

socket.on('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

socket.on('close', () => {
  process.exit();
});

process.stdin.on('end', () => {
  socket.end();
});
