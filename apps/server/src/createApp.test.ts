import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { describe, expect, it } from 'vitest';
import type { ClientEvents, ServerEvents, WorldSnapshot, WorldStateDto } from '../../../packages/shared/src/index.js';
import { createApp, startServer } from './createApp.js';

describe('world transport', () => {
  it('serves health and a complete read-only world; rejects position writes', async () => {
    const { app } = createApp();
    expect((await app.request('/api/health')).status).toBe(200);
    const response = await app.request('/api/world');
    const snapshot = await response.json() as WorldSnapshot;
    expect(snapshot.definition.entities).toHaveLength(213);
    expect(snapshot.state.agents[0]!.id).toBe('alpha');
    expect((await app.request('/api/world', { method: 'POST', body: '{}' })).status).toBe(404);
  });
  it('sends initial state, advancing deltas and a fresh snapshot on reconnect', async () => {
    const runtime = startServer(0);
    let socket: Socket<ServerEvents, ClientEvents> | undefined;
    try {
      if (!runtime.server.listening) await once(runtime.server, 'listening');
      const port = (runtime.server.address() as AddressInfo).port;
      socket = io(`http://127.0.0.1:${port}`, { autoConnect: false, transports: ['websocket'], reconnection: false });
      const initialPromise = new Promise<WorldSnapshot>(resolve => socket!.once('world:snapshot', resolve));
      socket.connect(); const initial = await initialPromise;
      const delta = await new Promise<WorldStateDto>(resolve => socket!.once('world:delta', resolve));
      expect(delta.tick).toBeGreaterThan(initial.state.tick);
      expect(delta.agents[0]!.position.x).toBeGreaterThan(initial.state.agents[0]!.position.x);
      socket.disconnect();
      const reconnected = new Promise<WorldSnapshot>(resolve => socket!.once('world:snapshot', resolve));
      socket.connect();
      expect((await reconnected).state.tick).toBeGreaterThanOrEqual(delta.tick);
    } finally { socket?.disconnect(); await runtime.close(); }
  }, 10000);
});
