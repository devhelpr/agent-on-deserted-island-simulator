import { startServer } from './createApp.js';
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const runtime = startServer(port);
runtime.server.on('listening', () => console.log(`Agent Island server: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void runtime.close(); });
