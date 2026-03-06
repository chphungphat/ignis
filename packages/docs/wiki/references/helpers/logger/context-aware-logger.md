---
title: Context Logger
description: SLF4J-inspired automatic context capture for Winston logging — adds className, methodName, and requestId prefixes with zero boilerplate.
---

# Context Logger

Automatic execution and request context capture for Winston logging, inspired by Java's SLF4J/Logback MDC pattern. A single `@logContext()` class decorator gives every method structured `[className][methodName][requestId]` log prefixes with no manual wiring.

## Quick Reference

| Export | Kind | Purpose |
|--------|------|---------|
| `ContextLogger` | class | Logger with automatic context prefix |
| `getContextLogger` | function | Shorthand for `ContextLogger.get()` |
| `getContextLoggerForMethod` | function | Shorthand for `ContextLogger.for()` — for standalone functions |
| `logContext` | decorator | Class decorator — wraps methods for context capture + injects `contextLogger` |
| `runWithExecutionContext` | function | Run a function with execution context in `AsyncLocalStorage` |
| `getExecutionContext` | function | Read current execution context from `AsyncLocalStorage` |
| `withLogContext` | function | Wrap a standalone function with execution context |
| `getRequestContext` | function | Read current request context from Hono's `contextStorage` |
| `IExecutionContext` | interface | `{ className?, methodName?, fileName? }` |
| `IRequestContext` | interface | `{ requestId?, path?, method?, url? }` |

#### Import Paths

```typescript
// Decorator (most common)
import { logContext } from '@venizia/ignis-helpers';

// Direct access
import { ContextLogger, getContextLogger, getContextLoggerForMethod } from '@venizia/ignis-helpers';

// Context helpers
import {
  runWithExecutionContext,
  getExecutionContext,
  withLogContext,
  getRequestContext,
} from '@venizia/ignis-helpers';

// Types
import type { IExecutionContext, IRequestContext } from '@venizia/ignis-helpers';
```

## Output Format

The logger dynamically builds a prefix from two independent context sources that merge at log time:

```
[className][methodName][requestId] message    # Inside HTTP request handler
[className][methodName] message               # Job/worker/test (no HTTP context)
[fileName][methodName] message                # Standalone function with fileName
message                                       # No @logContext decorator applied
```

Example output with pretty text format:

```
2026-03-02T10:30:00.000Z [APP] info: [UserService][createUser][req-abc123] Creating user: john
2026-03-02T10:30:01.000Z [APP] info: [EmailWorker][sendWelcome] Sending welcome email
```

## Quick Start

```typescript
import { logContext } from '@venizia/ignis-helpers';
import { BaseService } from '@venizia/ignis';

@logContext()
export class UserService extends BaseService {
  async createUser(data: any) {
    this.contextLogger.info('Creating user: %s', data.username);
    // HTTP:  [UserService][createUser][req-abc123] Creating user: john
    // Job:   [UserService][createUser] Creating user: john
  }

  async findById(id: string) {
    this.contextLogger.debug('Looking up user: %s', id);
    // [UserService][findById][req-abc123] Looking up user: usr_42
  }
}
```

That is it. No `LoggerFactory`, no `.for()` calls, no manual scoping. The decorator handles everything.

## Usage Patterns

### 1. With BaseService/BaseController (Most Common)

Add `@logContext()` to any class that extends a framework base class. The decorator injects a `contextLogger` getter on each instance. This property is separate from the `logger` inherited from `BaseHelper`.

```typescript
import { logContext } from '@venizia/ignis-helpers';
import { BaseService } from '@venizia/ignis';
import { injectable } from '@venizia/ignis-inversion';

@logContext()
@injectable({ scope: 'transient' })
export class PaymentService extends BaseService {
  async chargeCard(amount: number) {
    this.contextLogger.info('Charging card: %d', amount);
    // [PaymentService][chargeCard][req-abc123] Charging card: 50
  }
}
```

> [!TIP]
> `@logContext()` must be placed **above** `@injectable()` in the decorator stack so that the class returned to the IoC container already has its methods wrapped and `contextLogger` injected.

### 2. Standalone Class (No Framework Base)

Works on any class. The decorator auto-injects `this.contextLogger` — no base class needed.

```typescript
@logContext()
class EmailWorker {
  async sendWelcome(userId: string) {
    (this as any).contextLogger.info('Sending welcome email to: %s', userId);
    // [EmailWorker][sendWelcome] Sending welcome email to: usr_42
  }
}
```

If using TypeScript strict mode, declare the property:

```typescript
interface WithContextLogger {
  contextLogger: ContextLogger;
}

@logContext()
class EmailWorker implements WithContextLogger {
  contextLogger!: ContextLogger;
  // ...
}
```

### 3. Without Auto-Inject

Use `autoInject: false` to only wrap methods for context capture without touching the `contextLogger` property. Useful when you manage logger injection separately.

```typescript
@logContext({ autoInject: false })
class LegacyService {
  private logger = LoggerFactory.getLogger(['LegacyService']);

  async process() {
    // Methods are still wrapped — getExecutionContext() works
    // But no contextLogger is injected
    this.logger.info('Processing...');
  }
}
```

### 4. Standalone Functions with `withLogContext`

For functions that don't belong to a class, use `withLogContext` to wrap them with execution context:

```typescript
import { withLogContext, getContextLogger } from '@venizia/ignis-helpers';

export const processPayment = withLogContext(
  { className: 'PaymentUtils', methodName: 'processPayment' },
  async (amount: number) => {
    const logger = getContextLogger();
    logger.info('Processing: %d', amount);
    // [PaymentUtils][processPayment] Processing: 50
  }
);
```

### 5. Method-Scoped Logger with `getContextLoggerForMethod`

For standalone functions that want a logger with a custom `fileName` and/or `methodName`, without needing `withLogContext`:

```typescript
import { getContextLoggerForMethod } from '@venizia/ignis-helpers';

function handleWebhook(payload: any) {
  const logger = getContextLoggerForMethod({
    fileName: 'webhook-handler.ts',
    methodName: 'handleWebhook',
  });
  logger.info('Received webhook: %s', payload.type);
  // [webhook-handler.ts][handleWebhook] Received webhook: order.created
}
```

## How It Works

### Architecture

Two independent context sources merge at log time:

| Context Source | Storage Mechanism | Set By | Contains |
|----------------|-------------------|--------|----------|
| **Execution Context** | Node.js `AsyncLocalStorage` | `@logContext()` method wrapper | `className`, `methodName`, `fileName` |
| **Request Context** | Hono `contextStorage()` middleware | Framework request pipeline | `requestId`, `path`, `method`, `url` |

### Flow

**1. Class definition time** — `@logContext()` runs once per class:

```
@logContext() applied to UserService
  ├── STEP 1: Iterate prototype methods (skip constructor, getters, setters)
  │   └── Wrap each function with runWithExecutionContext()
  ├── STEP 2: Iterate static methods (skip JS built-in statics)
  │   └── Wrap each function with runWithExecutionContext()
  └── STEP 3: Return new class extending UserService
      └── Constructor defines this.contextLogger as a getter → getContextLogger()
```

**2. Method call time** — on every invocation of a wrapped method:

```
userService.createUser(data)
  └── wrappedMethod()
      └── runWithExecutionContext({ className: 'UserService', methodName: 'createUser' }, () => {
            // AsyncLocalStorage now holds { className, methodName }
            return originalCreateUser.apply(this, args)
          })
```

**3. Log time** — on every `this.contextLogger.info(...)` call:

```
this.contextLogger          ← getter fires
  └── getContextLogger()
      └── ContextLogger.get()
          ├── getExecutionContext()         → { className: 'UserService', methodName: 'createUser' }
          ├── Build cache key: 'UserService-createUser'
          └── Return cached ContextLogger instance

.info('Creating user')
  └── buildDynamicPrefix()
      ├── Read executionContext (cached on instance)  → [UserService][createUser]
      ├── getRequestContext()                          → { requestId: 'req-abc123' }
      └── Return '[UserService][createUser][req-abc123] '
  └── winstonLogger.info('[UserService][createUser][req-abc123] Creating user')
```

### Decorator Internals: The Metaprogramming

The `@logContext()` decorator uses three JavaScript reflection APIs to inspect and modify the class at definition time: `Object.getOwnPropertyNames`, `Object.getOwnPropertyDescriptor`, and `Object.defineProperty`. Here is exactly what each one does and why.

#### STEP 1: Wrapping Instance Methods

```typescript
const propertyNames = Object.getOwnPropertyNames(constructor.prototype);
```

**`Object.getOwnPropertyNames(constructor.prototype)`** returns an array of all property names defined directly on the prototype object. For a class like:

```typescript
class UserService {
  constructor() { ... }
  createUser() { ... }
  findById() { ... }
  get isActive() { ... }
}
```

It returns: `['constructor', 'createUser', 'findById', 'isActive']`.

This is different from `Object.keys()`, which only returns enumerable properties. Class methods and the `constructor` are non-enumerable by spec, so `getOwnPropertyNames` is required to see them.

The decorator explicitly skips `'constructor'` since the constructor is handled separately in STEP 3.

```typescript
const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, propertyName);
```

**`Object.getOwnPropertyDescriptor(obj, prop)`** returns a `PropertyDescriptor` object that describes exactly how a property is defined. For a regular method:

```typescript
{
  value: [Function: createUser],   // The actual function
  writable: true,                  // Can be reassigned
  enumerable: false,               // Won't show in for...in
  configurable: true,              // Can be redefined
}
```

For a getter:

```typescript
{
  get: [Function: get isActive],   // The getter function
  set: undefined,                  // No setter
  enumerable: false,
  configurable: true,
}
```

The decorator uses the descriptor to:
1. **Filter**: Skip non-functions (`typeof descriptor.value !== 'function'`) and getters/setters (`descriptor.get || descriptor.set`).
2. **Preserve**: When redefining the property, spread the original descriptor (`{ ...descriptor, value: wrappedMethod }`) to keep `writable`, `enumerable`, and `configurable` unchanged.

```typescript
Object.defineProperty(wrappedMethod, 'name', { value: originalMethod.name || propertyName });
```

**`Object.defineProperty(obj, prop, descriptor)`** creates or modifies a property on an object using a descriptor. Here it sets the `name` property on the wrapped function.

By default, a `function(...) { }` expression has `name: ''` (empty string). Reassigning `name` directly (`wrappedMethod.name = 'createUser'`) does not work because `Function.name` is non-writable. `defineProperty` bypasses this because `name` is still `configurable`.

This preserves the original method name for:
- Stack traces (error debugging)
- Route metadata (Hono uses `Function.name` internally)
- Reflection/introspection

```typescript
Object.defineProperty(constructor.prototype, propertyName, {
  ...descriptor,
  value: wrappedMethod,
});
```

This replaces the original method on the prototype with the wrapped version. The spread `...descriptor` preserves the original property attributes (`writable`, `enumerable`, `configurable`) so the replacement is invisible to other code that inspects the prototype.

#### STEP 2: Wrapping Static Methods

Static methods live directly on the constructor function itself (not on `.prototype`). The same pattern applies:

```typescript
const staticNames = Object.getOwnPropertyNames(constructor);
```

For a class with a static method:

```typescript
class UserService {
  static fromDTO(dto: any) { ... }
}
```

This returns: `['length', 'name', 'prototype', 'arguments', 'caller', 'fromDTO']`.

The first five are JavaScript built-in properties on every function object. They must be skipped — wrapping or redefining `length`, `name`, or `prototype` would break the class. The decorator uses a `STATIC_BUILTINS` Set for this:

```typescript
const STATIC_BUILTINS = new Set(['length', 'name', 'prototype', 'arguments', 'caller']);
```

| Built-in | Value | Why skip |
|----------|-------|----------|
| `length` | Number of expected arguments | Not a method |
| `name` | `'UserService'` | The class name — not a method |
| `prototype` | The prototype object | Not a method |
| `arguments` | Legacy, deprecated | Not a method, would throw in strict mode |
| `caller` | Legacy, deprecated | Not a method, would throw in strict mode |

#### STEP 3: Constructor Wrapping

```typescript
const wrapped = class extends constructor {
  constructor(...args: any[]) {
    super(...args);
    Object.defineProperty(this, 'contextLogger', {
      get() { return getContextLogger(); },
      configurable: true,
      enumerable: false,
    });
  }
};
```

This creates an anonymous class that extends the original, with a constructor that:

1. Calls `super(...args)` — executes the original constructor (including any parent constructors like `BaseHelper` that set `this.logger`)
2. Defines `contextLogger` as a **getter** on the instance using `defineProperty`

Why a getter and not a value?
- A getter (`get()`) is called **every time** the property is accessed
- This means `this.contextLogger` always returns the logger for the **current** `AsyncLocalStorage` scope
- If it were a plain value (set once in the constructor), it would capture the context at construction time, not at method execution time

Why `configurable: true`?
- Allows subclasses or test code to override the getter if needed

Why `enumerable: false`?
- Prevents `contextLogger` from appearing in `Object.keys()`, `JSON.stringify()`, or `for...in` loops
- This keeps it invisible to serialization and iteration — it is an internal mechanism, not data

```typescript
Object.defineProperty(wrapped, 'name', { value: className });
```

The anonymous `class extends constructor` has `name: ''` by default. This restores the original class name so that `constructor.name` still returns `'UserService'`, not `''`. This matters for:
- IoC container binding keys (`controllers.UserService`)
- Error messages and stack traces
- The `@logContext()` decorator itself, which reads `constructor.name` for the execution context

### Why Instance-Level, Not Prototype-Level?

The getter is defined on `this` (the instance), not on `constructor.prototype`. This is intentional:

```typescript
// Prototype-level getter — would be overridden by parent constructor
Object.defineProperty(constructor.prototype, 'contextLogger', { get() { ... } });
// super() runs → BaseHelper sets this.logger = value → value assignment shadows prototype getter

// Instance-level getter (what we do) — runs AFTER super()
super(...args);
Object.defineProperty(this, 'contextLogger', { get() { ... } });
// Instance-level property always wins over prototype-level
```

JavaScript's property lookup goes: own properties first → prototype chain. By defining the getter on the instance after `super()`, it takes precedence over any value or getter in the prototype chain.

### AsyncLocalStorage Isolation

Each method call gets its own `AsyncLocalStorage.run()` scope. Concurrent calls — even on the same instance — cannot leak context:

```typescript
// These run concurrently with isolated contexts
await Promise.all([
  userService.createUser(data1),  // ALS scope: { className: 'UserService', methodName: 'createUser' }
  userService.findById(id),       // ALS scope: { className: 'UserService', methodName: 'findById' }
]);
```

### Request Context Resolution

`getRequestContext()` reads from Hono's `contextStorage()` middleware via `tryGetContext()`. It extracts:

- **requestId**: From `context.get('requestId')` or the `X-Request-Id` header
- **path**: From `context.req.path`
- **method**: From `context.req.method`
- **url**: From `context.req.url`

Returns `null` outside HTTP context (jobs, workers, tests, CLI scripts). This is expected and safe — the logger simply omits the `[requestId]` segment. The function is wrapped in try/catch to handle edge cases where `tryGetContext()` may throw.

## SLF4J/Logback Comparison

For developers familiar with Java's logging ecosystem:

| Java (SLF4J/Logback) | Ignis | Notes |
|---|---|---|
| `LoggerFactory.getLogger(Class)` | `@logContext()` decorator | One decorator replaces explicit factory calls |
| MDC (Mapped Diagnostic Context) | `AsyncLocalStorage` | Both provide per-execution storage |
| `%logger` pattern | `[className]` prefix | Class name in log output |
| `%method` pattern | `[methodName]` prefix | Method name in log output |
| `%X{requestId}` MDC | `[requestId]` from Hono context | Request-scoped variable |
| `@Slf4j` (Lombok) | `@logContext()` with `autoInject: true` | Auto-injects logger field |
| Thread-local storage | `AsyncLocalStorage` | Per-execution, not per-thread (Node.js is single-threaded) |

> [!NOTE]
> The key conceptual difference: Java's MDC is thread-local, while Node.js `AsyncLocalStorage` is per-execution-context. In practice they serve the same purpose — isolating diagnostic data per request — but `AsyncLocalStorage` correctly follows `async/await` chains across microtask boundaries.

## Performance Characteristics

| Operation | Cost | When |
|-----------|------|------|
| `@logContext()` decorator application | Once at class definition time | Module load |
| Method wrapping overhead | ~1-5 microseconds (`AsyncLocalStorage.run()`) | Per method invocation |
| `contextLogger` getter access | `Map` lookup by cached key (~nanoseconds) | Per `this.contextLogger` access |
| `buildDynamicPrefix()` | String concatenation + one ALS read + one Hono context read (~1-5 microseconds) | Per log call |

> [!TIP]
> The `@logContext()` decorator itself has **zero runtime cost** — it runs once at module load. The per-call overhead is dominated by `AsyncLocalStorage.run()`, which Node.js has optimized significantly since v16. For the vast majority of applications, this overhead is unmeasurable in practice.

## Decorator Options

```typescript
@logContext(options?)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoInject` | `boolean` | `true` | Auto-inject `this.contextLogger` as a getter returning `ContextLogger` |
| `fileName` | `string` | `undefined` | Include source file name in execution context |

```typescript
// Default — wraps methods AND injects contextLogger
@logContext()

// Only wrap methods for context capture, don't touch contextLogger property
@logContext({ autoInject: false })

// Include file name in context metadata
@logContext({ fileName: 'user.service.ts' })
```

## Troubleshooting

### Logger shows plain `Logger` instead of `ContextLogger`

**Cause:** The `@logContext()` decorator is missing from the class, or `autoInject: false` was passed.

**Fix:** Add `@logContext()` to the class declaration. Ensure `autoInject` is not set to `false` (it defaults to `true`).

### No `requestId` in output

**Cause:** The code is running outside HTTP context (job, worker, test, CLI), or Hono's `contextStorage()` middleware is not enabled.

**Fix:**
1. If running in a background job or worker, this is expected. The logger will produce `[className][methodName]` without a request ID.
2. For HTTP handlers, verify that `asyncContext.enable` is `true` in your application config (this is the default). The application must call Hono's `contextStorage()` middleware for request context to be available.

### `contextLogger` is undefined

**Cause:** You passed `autoInject: false` to `@logContext()`, or the class does not have the decorator applied.

**Fix:** Either remove `autoInject: false`, or use `getContextLogger()` to obtain a logger manually within a wrapped method.

### Context leaking between concurrent requests

**Cause:** This should not happen. `AsyncLocalStorage` provides per-execution isolation.

**Fix:** Verify that you are not manually sharing state across requests (e.g., storing context in a module-level variable). Each `AsyncLocalStorage.run()` call creates an isolated scope that follows the full `async/await` chain.

## Internals Reference

### IExecutionContext

```typescript
interface IExecutionContext {
  className?: string;   // Class name from @logContext decorator
  methodName?: string;  // Method name being executed
  fileName?: string;    // Optional source file name
}
```

### IRequestContext

```typescript
interface IRequestContext {
  requestId?: string;   // From context.get('requestId') or X-Request-Id header
  path?: string;        // Request path (e.g., '/api/users')
  method?: string;      // HTTP method (e.g., 'GET', 'POST')
  url?: string;         // Full request URL
}
```

### File Locations

| File | Package | Purpose |
|------|---------|---------|
| `modules/logger/context-logger.ts` | helpers | `ContextLogger` class, `getContextLogger`, `getContextLoggerForMethod` |
| `modules/logger/decorators.ts` | helpers | `@logContext()` decorator |
| `modules/context/execution-context.ts` | helpers | `AsyncLocalStorage`, `runWithExecutionContext`, `getExecutionContext`, `withLogContext` |
| `modules/context/request-context.ts` | helpers | `getRequestContext` (reads Hono context) |
| `base/metadata/request-context.ts` | core | `useRequestContext` — typed access to Hono context from core |

## See Also

- **Logger:**
  - [Logger Reference](/references/helpers/logger/) -- Base logger, transports, HfLogger, environment variables

- **Related Concepts:**
  - [Services](/guides/core-concepts/services) -- Using loggers in services
  - [Controllers](/guides/core-concepts/controllers) -- Using loggers in controllers

- **Other Helpers:**
  - [Helpers Index](/references/helpers/) -- All available helpers
  - [Inversion (DI)](/references/helpers/inversion/) -- IoC container and decorators
