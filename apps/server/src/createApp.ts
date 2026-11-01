import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Server } from 'socket.io';
import type { ClientEvents, ServerEvents } from '../../../packages/shared/src/index.js';
import { generateWorld } from './world/generateWorld.js';
import { WorldEngine, TICK_MS } from './world/WorldEngine.js';

export function createApp() {
  const engine = new WorldEngine(generateWorld());
  const app = new Hono();
  app.get('/api/health', c => c.json({ status: 'ok' }));
  app.get('/api/world', c => c.json(engine.getSnapshot()));
  return { app, engine };
}
export function startServer(port = 3001) {
  const { app, engine } = createApp();
  const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });
  const io = new Server<ClientEvents, ServerEvents>(server);
  io.on('connection', socket => socket.emit('world:snapshot', engine.getSnapshot()));
  // Minimal realtime runner for sprint 1. Full clock, speed control and queue: sprint 2.
  let previous = performance.now(); let accumulator = 0;
  const simulation = setInterval(() => {
    const now = performance.now(); accumulator += now - previous; previous = now;
    let steps = 0;
    while (accumulator >= TICK_MS && steps < 100) { engine.step(); accumulator -= TICK_MS; steps++; }
  }, 10);
  const network = setInterval(() => io.emit('world:delta', engine.getState()), 100);
  const close = async () => {
    clearInterval(simulation); clearInterval(network);
    await new Promise<void>(resolve => io.close(() => resolve()));
  };
  return { server, io, engine, close };
}
