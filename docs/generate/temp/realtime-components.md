# Real-time Components: Socket.IO & WebSocket

This guide covers how to use the two real-time components exported by the Ignis framework — `SocketIOComponent` and `WebSocketComponent` — in your application.

---

## Overview

| Feature | SocketIOComponent | WebSocketComponent |
|---|---|---|
| Protocol | Socket.IO (with HTTP fallback) | Native WebSocket (RFC 6455) |
| Runtime | Bun + Node.js | **Bun only** |
| Redis adapter | `@socket.io/redis-adapter` (pub/sub) | Custom Redis pub/sub |
| Client helper | `SocketIOClientHelper` | — |
| Server emitter | `SocketIOServerHelper.send()` | `WebSocketEmitter` or `WebSocketServerHelper.send()` |
| Default path | `/io` | `/ws` |
| Authentication | Post-connect event (`authenticate`) | First message event (`authenticate`) |
| Encryption | — | Optional ECDH handshake (`requireEncryption`) |

Both components require a **Redis connection** for cross-instance message fan-out (horizontal scaling).

---

## Import Paths

Both components live on **subpath exports** — not the main `@venizia/ignis` barrel — because they pull in large optional peer dependencies.

```typescript
// Socket.IO component + binding keys
import { SocketIOBindingKeys, SocketIOComponent } from '@venizia/ignis/socket-io';

// WebSocket component + binding keys
import { WebSocketBindingKeys, WebSocketComponent } from '@venizia/ignis/websocket';

// Server helpers + types (from helpers package)
import {
  SocketIOServerHelper,
  TSocketIOAuthenticateFn,
  TSocketIOValidateRoomFn,
  TSocketIOClientConnectedFn,
} from '@venizia/ignis-helpers';

// WebSocket-specific types from helpers
import {
  WebSocketServerHelper,
  WebSocketEmitter,
  TWebSocketAuthenticateFn,
  TWebSocketValidateRoomFn,
  TWebSocketClientConnectedFn,
  TWebSocketClientDisconnectedFn,
  TWebSocketMessageHandler,
  TWebSocketOutboundTransformer,
  TWebSocketHandshakeFn,
} from '@venizia/ignis-helpers';

// SocketIOClientHelper is on a dedicated subpath
import { SocketIOClientHelper } from '@venizia/ignis-helpers/socket-io';
```

---

## How Configuration Works

Both components follow the same **IoC-first** pattern:

1. Create the Redis helper
2. `app.bind(BindingKey).toValue(...)` for each option
3. `app.component(XComponent)` — this reads all bindings and registers a post-start hook
4. The actual server helper (e.g., `SocketIOServerHelper`) becomes available in the container **only after** `app.start()` resolves

> **Never inject the server helper via constructor `@inject`.** Use a lazy getter that reads from the container at call time (see the Service pattern below).

---

## SocketIOComponent

### 1. Required Bindings

| Key | Type | Required | Description |
|---|---|---|---|
| `SocketIOBindingKeys.REDIS_CONNECTION` | `DefaultRedisHelper` | Yes | Redis for pub/sub adapter |
| `SocketIOBindingKeys.AUTHENTICATE_HANDLER` | `TSocketIOAuthenticateFn` | Yes | Validates the socket handshake — returning `false` disconnects the client |
| `SocketIOBindingKeys.VALIDATE_ROOM_HANDLER` | `TSocketIOValidateRoomFn` | No | Filters the room list when a client sends a `join` event |
| `SocketIOBindingKeys.CLIENT_CONNECTED_HANDLER` | `TSocketIOClientConnectedFn` | No | Hook called after a client authenticates successfully |
| `SocketIOBindingKeys.SERVER_OPTIONS` | `Partial<ServerOptions & { identifier: string }>` | No | Overrides default Socket.IO server options |

### 2. Default Server Options

```typescript
// These are applied if you do not override SERVER_OPTIONS
{
  identifier: 'SOCKET_IO_SERVER',
  path: '/io',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
    credentials: true,
  },
  perMessageDeflate: { threshold: 4096, /* ... */ },
}
```

### 3. Setup in Application

```typescript
import { BaseApplication } from '@venizia/ignis';
import { SocketIOBindingKeys, SocketIOComponent } from '@venizia/ignis/socket-io';
import {
  RedisHelper,
  SocketIOServerHelper,
  TSocketIOAuthenticateFn,
  TSocketIOClientConnectedFn,
  TSocketIOValidateRoomFn,
} from '@venizia/ignis-helpers';

export class Application extends BaseApplication {
  private redisHelper: RedisHelper;

  setupSocketIO() {
    // 1. Create Redis connection (autoConnect: false — component will connect it)
    this.redisHelper = new RedisHelper({
      name: 'socket-io-redis',
      host: process.env.REDIS_HOST!,
      port: Number(process.env.REDIS_PORT),
      password: process.env.REDIS_PASSWORD,
      autoConnect: false,
    });

    this.bind<RedisHelper>({
      key: SocketIOBindingKeys.REDIS_CONNECTION,
    }).toValue(this.redisHelper);

    // 2. Authentication — receives the Socket.IO handshake object
    const authenticateFn: TSocketIOAuthenticateFn = async handshake => {
      const token = handshake.auth?.token ?? handshake.headers.authorization;
      if (!token) return false;
      // Validate JWT, session, etc.
      return true;
    };

    this.bind<TSocketIOAuthenticateFn>({
      key: SocketIOBindingKeys.AUTHENTICATE_HANDLER,
    }).toValue(authenticateFn);

    // 3. Room validation (optional) — return only the rooms you allow
    const validateRoomFn: TSocketIOValidateRoomFn = ({ socket, rooms }) => {
      // Filter to allowed rooms. Return [] to deny all.
      return rooms.filter(r => r.startsWith('public:'));
    };

    this.bind<TSocketIOValidateRoomFn>({
      key: SocketIOBindingKeys.VALIDATE_ROOM_HANDLER,
    }).toValue(validateRoomFn);

    // 4. Post-auth hook (optional) — register per-socket event handlers here
    const clientConnectedFn: TSocketIOClientConnectedFn = ({ socket }) => {
      socket.on('chat:message', data => {
        // handle custom events from this socket
      });
    };

    this.bind<TSocketIOClientConnectedFn>({
      key: SocketIOBindingKeys.CLIENT_CONNECTED_HANDLER,
    }).toValue(clientConnectedFn);

    // 5. Register the component — must come AFTER all bindings
    this.component(SocketIOComponent);
  }

  preConfigure() {
    this.setupSocketIO();
    // ... other components/services/controllers
  }

  override async stop() {
    const socketIOHelper = this.get<SocketIOServerHelper>({
      key: SocketIOBindingKeys.SOCKET_IO_INSTANCE,
      isOptional: true,
    });
    if (socketIOHelper) {
      await socketIOHelper.shutdown();
    }
    if (this.redisHelper) {
      await this.redisHelper.disconnect();
    }
    await super.stop();
  }
}
```

### 4. Using SocketIOServerHelper from a Service

The server helper is bound into the container after `app.start()`. Use a **lazy getter**:

```typescript
import { BaseService, BaseApplication, CoreBindings, inject, SocketIOBindingKeys } from '@venizia/ignis';
import { SocketIOServerHelper, ISocketIOClient } from '@venizia/ignis-helpers';

export class NotificationService extends BaseService {
  private _io: SocketIOServerHelper | null = null;

  constructor(
    @inject({ key: CoreBindings.APPLICATION_INSTANCE })
    private application: BaseApplication,
  ) {
    super({ scope: NotificationService.name });
  }

  private get io(): SocketIOServerHelper {
    if (!this._io) {
      this._io = this.application.get<SocketIOServerHelper>({
        key: SocketIOBindingKeys.SOCKET_IO_INSTANCE,
        isOptional: true,
      }) ?? null;
    }
    if (!this._io) {
      throw new Error('SocketIO not initialized yet');
    }
    return this._io;
  }

  // Broadcast to all authenticated clients
  broadcast(event: string, data: unknown) {
    this.io.send({ payload: { topic: event, data } });
  }

  // Send to a specific socket ID or room name
  sendTo(destination: string, event: string, data: unknown) {
    this.io.send({ destination, payload: { topic: event, data } });
  }

  // Directly access the underlying Socket.IO server
  getIOServer() {
    return this.io.getIOServer();
  }
}
```

### 5. Socket.IO Protocol

The component enforces a state machine for each client:

```
connect → UNAUTHORIZED
  ↓  client emits "authenticate"
  ↓  server calls authenticateFn(handshake)
  → true  → AUTHENTICATED → server emits "authenticated" → client joins default rooms
  → false → server emits "unauthenticated" → disconnect
```

**Default rooms** every authenticated client joins automatically:
- `io-default`
- `io-notification`

**Reserved events** (sent by server):
- `ping` — server heartbeat every 30 s
- `authenticated` — auth success, carries `{ id, time }`
- `unauthenticated` — auth failed, carries `{ message, time }`

**Reserved events** (sent by client):
- `authenticate` — triggers auth flow
- `join` — `{ rooms: string[] }` — requires `validateRoomFn` to be set
- `leave` — `{ rooms: string[] }`

---

## WebSocketComponent

### 1. Required Bindings

| Key | Type | Required | Description |
|---|---|---|---|
| `WebSocketBindingKeys.REDIS_CONNECTION` | `DefaultRedisHelper` | Yes | Redis for cross-instance messaging |
| `WebSocketBindingKeys.AUTHENTICATE_HANDLER` | `TWebSocketAuthenticateFn` | Yes | Called when client sends `authenticate` event; returns `{ userId?, metadata? }` or `null`/`false` to reject |
| `WebSocketBindingKeys.VALIDATE_ROOM_HANDLER` | `TWebSocketValidateRoomFn` | No | Filters `join` room requests |
| `WebSocketBindingKeys.CLIENT_CONNECTED_HANDLER` | `TWebSocketClientConnectedFn` | No | Hook after successful authentication |
| `WebSocketBindingKeys.CLIENT_DISCONNECTED_HANDLER` | `TWebSocketClientDisconnectedFn` | No | Hook on disconnect |
| `WebSocketBindingKeys.MESSAGE_HANDLER` | `TWebSocketMessageHandler` | No | Handles all non-system events after authentication |
| `WebSocketBindingKeys.OUTBOUND_TRANSFORMER` | `TWebSocketOutboundTransformer` | No | Intercepts outbound messages (e.g., encrypt payload) |
| `WebSocketBindingKeys.HANDSHAKE_HANDLER` | `TWebSocketHandshakeFn` | No* | Required when `requireEncryption: true` |
| `WebSocketBindingKeys.SERVER_OPTIONS` | `Partial<IServerOptions>` | No | Overrides identifier, path, heartbeat config, etc. |

### 2. Server Options (`IServerOptions`)

```typescript
interface IServerOptions {
  identifier?: string;       // Default: 'WEBSOCKET_SERVER'
  path?: string;             // Default: '/ws'
  defaultRooms?: string[];   // Default: ['ws-default', 'ws-notification']
  serverOptions?: {          // Bun WebSocket native config
    perMessageDeflate?: boolean;
    maxPayloadLength?: number; // Default: 128 KB
    idleTimeout?: number;      // Default: 60 s
    sendPings?: boolean;       // Default: true
  };
  heartbeatInterval?: number; // Default: 30_000 ms
  heartbeatTimeout?: number;  // Default: 90_000 ms (3x interval)
  requireEncryption?: boolean; // Default: false
}
```

### 3. Setup in Application

```typescript
import { BaseApplication } from '@venizia/ignis';
import { WebSocketBindingKeys, WebSocketComponent } from '@venizia/ignis/websocket';
import {
  RedisHelper,
  WebSocketServerHelper,
  TWebSocketAuthenticateFn,
  TWebSocketValidateRoomFn,
  TWebSocketClientConnectedFn,
  TWebSocketClientDisconnectedFn,
  TWebSocketMessageHandler,
} from '@venizia/ignis-helpers';

export class Application extends BaseApplication {
  private redisHelper: RedisHelper;

  setupWebSocket() {
    // 1. Redis
    this.redisHelper = new RedisHelper({
      name: 'websocket-redis',
      host: process.env.REDIS_HOST!,
      port: Number(process.env.REDIS_PORT),
      autoConnect: false,
    });

    this.bind<RedisHelper>({
      key: WebSocketBindingKeys.REDIS_CONNECTION,
    }).toValue(this.redisHelper);

    // 2. Optional server options override
    this.bind({ key: WebSocketBindingKeys.SERVER_OPTIONS }).toValue({
      serverOptions: { sendPings: true },
      heartbeatInterval: 30_000,
      heartbeatTimeout: 90_000,
    });

    // 3. Authentication — payload is the data from the client's authenticate event
    //    Return { userId?, metadata? } to allow, or null/false to reject (closes with code 4003)
    const authenticateFn: TWebSocketAuthenticateFn = async payload => {
      const { token } = payload as { token?: string };
      if (!token) return null;
      // Validate token...
      return { userId: 'user-123', metadata: { role: 'admin' } };
    };

    this.bind<TWebSocketAuthenticateFn>({
      key: WebSocketBindingKeys.AUTHENTICATE_HANDLER,
    }).toValue(authenticateFn);

    // 4. Room validation (optional)
    const validateRoomFn: TWebSocketValidateRoomFn = ({ clientId, userId, rooms }) => {
      return rooms.filter(r => r.startsWith('public:') || r === `user:${userId}`);
    };

    this.bind<TWebSocketValidateRoomFn>({
      key: WebSocketBindingKeys.VALIDATE_ROOM_HANDLER,
    }).toValue(validateRoomFn);

    // 5. Lifecycle hooks (optional)
    this.bind<TWebSocketClientConnectedFn>({
      key: WebSocketBindingKeys.CLIENT_CONNECTED_HANDLER,
    }).toValue(({ clientId, userId, metadata }) => {
      console.log(`Connected: clientId=${clientId} userId=${userId}`);
    });

    this.bind<TWebSocketClientDisconnectedFn>({
      key: WebSocketBindingKeys.CLIENT_DISCONNECTED_HANDLER,
    }).toValue(({ clientId, userId }) => {
      console.log(`Disconnected: clientId=${clientId} userId=${userId}`);
    });

    // 6. Message handler — all non-system events after auth
    const messageHandler: TWebSocketMessageHandler = ({ clientId, userId, message }) => {
      switch (message.event) {
        case 'echo':
          // handled by service
          break;
      }
    };

    this.bind<TWebSocketMessageHandler>({
      key: WebSocketBindingKeys.MESSAGE_HANDLER,
    }).toValue(messageHandler);

    // 7. Register component
    this.component(WebSocketComponent);
  }

  preConfigure() {
    this.setupWebSocket();
  }

  override async stop() {
    const wsHelper = this.get<WebSocketServerHelper>({
      key: WebSocketBindingKeys.WEBSOCKET_INSTANCE,
      isOptional: true,
    });
    if (wsHelper) await wsHelper.shutdown();
    if (this.redisHelper) await this.redisHelper.disconnect();
    await super.stop();
  }
}
```

### 4. Using WebSocketServerHelper from a Service

Same lazy getter pattern as Socket.IO:

```typescript
import { BaseService, BaseApplication, CoreBindings, inject, WebSocketBindingKeys } from '@venizia/ignis';
import { WebSocketServerHelper, IWebSocketClient, IWebSocketMessage } from '@venizia/ignis-helpers';

export class ChatService extends BaseService {
  private _ws: WebSocketServerHelper | null = null;

  constructor(
    @inject({ key: CoreBindings.APPLICATION_INSTANCE })
    private application: BaseApplication,
  ) {
    super({ scope: ChatService.name });
  }

  private get ws(): WebSocketServerHelper {
    if (!this._ws) {
      this._ws = this.application.get<WebSocketServerHelper>({
        key: WebSocketBindingKeys.WEBSOCKET_INSTANCE,
        isOptional: true,
      }) ?? null;
    }
    if (!this._ws) throw new Error('WebSocket not initialized yet');
    return this._ws;
  }

  // Send to a specific connected client by clientId
  sendToClient(clientId: string, event: string, data: unknown) {
    this.ws.sendToClient({ clientId, event, data });
  }

  // Send to all connections belonging to a userId
  sendToUser(userId: string, event: string, data: unknown) {
    this.ws.sendToUser({ userId, event, data });
  }

  // Fan-out to all clients in a room
  sendToRoom(room: string, event: string, data: unknown) {
    this.ws.sendToRoom({ room, event, data });
  }

  // Broadcast to all authenticated clients
  broadcast(event: string, data: unknown) {
    this.ws.broadcast({ event, data });
  }

  // Universal send — resolves destination as clientId, room, or broadcast
  send(destination: string | undefined, event: string, data: unknown) {
    this.ws.send({ destination, payload: { topic: event, data } });
  }

  // Handle incoming messages (called from the messageHandler binding)
  handleMessage(opts: { clientId: string; userId?: string; message: IWebSocketMessage }) {
    const { clientId, message } = opts;

    switch (message.event) {
      case 'echo': {
        this.ws.sendToClient({
          clientId,
          event: 'echo:response',
          data: { original: message.data, timestamp: new Date().toISOString() },
        });
        break;
      }
    }
  }
}
```

### 5. WebSocket Protocol

Messages are JSON-framed as `IWebSocketMessage`:

```typescript
interface IWebSocketMessage<DataType = unknown> {
  event: string;
  data?: DataType;
  id?: string;
}
```

**Client → Server reserved events:**
- `authenticate` — must be sent first; payload is passed to `authenticateFn`
- `join` — `{ rooms: string[] }` — requires `validateRoomFn`
- `leave` — `{ rooms: string[] }`
- `heartbeat` — keep-alive (silently consumed, resets inactivity timer)

**Server → Client reserved events:**
- `connected` — auth success, carries `{ id, userId, time }` (+ `serverPublicKey`/`salt` if encrypted)
- `error` — carries `{ message: string }`
- `disconnect` — connection closing

**Close codes:**
- `4001` — authentication timeout (client didn't authenticate within `authTimeout` ms)
- `4003` — authentication rejected
- `4004` — encryption handshake failed (only when `requireEncryption: true`)
- `4002` — heartbeat timeout (no activity within `heartbeatTimeout` ms)

**Default rooms** joined after successful auth:
- `ws-default`
- `ws-notification`

### 6. Using WebSocketEmitter (service-layer emitter, no server instance needed)

If you need to send WebSocket messages from a service that doesn't have access to the running server (e.g., a background worker, a different process), use `WebSocketEmitter`. It publishes directly to Redis and the live server instances fan the message out to clients.

```typescript
import { WebSocketEmitter } from '@venizia/ignis-helpers';
import { RedisHelper } from '@venizia/ignis-helpers';

const emitter = new WebSocketEmitter({
  identifier: 'my-background-emitter',
  redisConnection: new RedisHelper({ host: 'localhost', port: 6379, autoConnect: true }),
});
await emitter.configure();

// Target specific client
await emitter.toClient({ clientId: 'abc-123', event: 'notification', data: { text: 'Hello' } });

// Target all connections for a user (across all server instances)
await emitter.toUser({ userId: 'user-456', event: 'balance:updated', data: { balance: 100 } });

// Fan-out to room
await emitter.toRoom({ room: 'ws-notification', event: 'alert', data: { level: 'info' } });

// Broadcast to all connected clients on all instances
await emitter.broadcast({ event: 'system:update', data: { version: '2.0' } });

// Cleanup
await emitter.shutdown();
```

### 7. Outbound Transformer (E2E Encryption)

The `outboundTransformer` intercepts every outbound message for encrypted clients. Use it to encrypt payloads before delivery.

```typescript
import { TWebSocketOutboundTransformer } from '@venizia/ignis-helpers';

const outboundTransformer: TWebSocketOutboundTransformer = async ({ client, event, data }) => {
  if (!client.encrypted) {
    return { event, data }; // pass through
  }
  // Encrypt with client's key material (stored in client.serverPublicKey/client.salt/client.metadata)
  const encrypted = await encryptPayload({ event, data, key: client.serverPublicKey! });
  return { event: 'encrypted', data: encrypted };
};

this.bind<TWebSocketOutboundTransformer>({
  key: WebSocketBindingKeys.OUTBOUND_TRANSFORMER,
}).toValue(outboundTransformer);
```

---

## SocketIOClientHelper

A client-side helper for connecting to a Socket.IO server. Useful for server-to-server or test scenarios.

```typescript
import { SocketIOClientHelper } from '@venizia/ignis-helpers/socket-io';

const client = new SocketIOClientHelper({
  identifier: 'my-client',
  host: 'http://localhost:3000',
  options: {
    path: '/io',
    extraHeaders: { authorization: 'Bearer <token>' },
    autoConnect: true,  // default: true
    reconnection: true, // default: true
  },
  onConnected: () => {
    client.authenticate(); // trigger auth flow
  },
  onAuthenticated: () => {
    client.joinRooms({ rooms: ['io-notification'] });
    client.subscribe({ event: 'notification', handler: data => console.log(data) });
  },
  onUnauthenticated: message => console.error('Auth failed:', message),
  onDisconnected: reason => console.log('Disconnected:', reason),
  onError: error => console.error('Connection error:', error),
});

// Subscribe to events
client.subscribe({ event: 'chat:message', handler: data => console.log(data) });

// Subscribe to many events at once
client.subscribeMany({
  events: {
    'chat:message': data => handleChat(data),
    'notification': data => handleNotification(data),
  },
});

// Emit to server
client.emit({ topic: 'echo', data: { text: 'hello' } });

// Room management
client.joinRooms({ rooms: ['room-a', 'room-b'] });
client.leaveRooms({ rooms: ['room-a'] });

// Manual connect/disconnect
client.connect();     // when autoConnect: false
client.disconnect();  // graceful
client.shutdown();    // disconnect + remove all listeners + reset state
```

**Client state machine:**
- `UNAUTHORIZED` → initial state, and after disconnect/unauthenticated
- `AUTHENTICATING` → after `client.authenticate()` is called
- `AUTHENTICATED` → after server emits `authenticated`

`subscribe()` deduplicates listeners by default (`ignoreDuplicate: true`). Pass `ignoreDuplicate: false` to allow multiple handlers for the same event.

---

## Peer Dependencies

Install these in your consuming application:

```bash
# For SocketIOComponent (Bun runtime)
bun add socket.io @socket.io/redis-adapter @socket.io/redis-emitter @socket.io/bun-engine

# For SocketIOComponent (Node.js runtime)
bun add socket.io @socket.io/redis-adapter @socket.io/redis-emitter

# For SocketIOClientHelper
bun add socket.io-client

# For WebSocketComponent (Bun only — no extra socket libs needed)
# WebSocket is native to Bun's server

# Both require Redis:
bun add ioredis
```

---

## Quick Comparison: When to Use Which

**Use `SocketIOComponent` when:**
- You need Node.js compatibility
- You want automatic reconnection, fallback transports (long-poll), and the Socket.IO event model
- You're using `SocketIOClientHelper` for server-to-server communication
- You want Socket.IO's room fan-out managed by the Socket.IO adapter

**Use `WebSocketComponent` when:**
- You're running on Bun and want maximum throughput (Bun's native WebSocket uses C++ pub/sub for O(1) room fan-out)
- You need fine-grained message handling with `messageHandler`
- You want optional E2E encryption via `outboundTransformer` + `handshakeFn`
- You need per-user targeting (`sendToUser`) or the `WebSocketEmitter` from background processes

---

## Registering Both Simultaneously

You can use both components in the same application — they use separate binding key namespaces and separate Redis connections:

```typescript
preConfigure() {
  this.setupSocketIO();   // uses SocketIOBindingKeys.*
  this.setupWebSocket();  // uses WebSocketBindingKeys.*
  // ...
}
```
