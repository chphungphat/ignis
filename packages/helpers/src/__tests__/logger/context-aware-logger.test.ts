/** Context Logger Test Suite */

import { describe, test, expect } from 'bun:test';
import { ContextLogger, getContextLogger } from '@/modules/logger/context-logger';
import {
  runWithExecutionContext,
  getExecutionContext,
  withLogContext,
} from '@/modules/context/execution-context';
import { logContext } from '@/modules/logger/decorators';

describe('Context Logger', () => {
  // ─────────────────────────────────────────────────────────────
  describe('ContextLogger', () => {
    test('TC-010: should return cached instance for same className-methodName', () => {
      runWithExecutionContext({ className: 'Svc', methodName: 'run' }, () => {
        const a = ContextLogger.get();
        const b = ContextLogger.get();
        expect(a).toBe(b);
      });
    });

    test('TC-011: should return different instances for different keys', () => {
      let loggerA: any;
      let loggerB: any;

      runWithExecutionContext({ className: 'SvcA', methodName: 'run' }, () => {
        loggerA = ContextLogger.get();
      });

      runWithExecutionContext({ className: 'SvcB', methodName: 'run' }, () => {
        loggerB = ContextLogger.get();
      });

      expect(loggerA).not.toBe(loggerB);
    });

    test('TC-012: should return default logger when called outside execution context', () => {
      const logger = ContextLogger.get();
      expect(logger).toBeDefined();
    });

    test('TC-013: should not crash in non-HTTP context (no requestId)', () => {
      runWithExecutionContext({ className: 'JobSvc', methodName: 'process' }, () => {
        const logger = ContextLogger.get();
        // Should not throw — getRequestContext returns null outside HTTP
        expect(() => logger.info('test message')).not.toThrow();
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('ContextLogger.for()', () => {
    test('TC-014: should create logger with custom fileName and methodName', () => {
      const logger = ContextLogger.for({ fileName: 'utils.ts', methodName: 'helper' });
      expect(logger).toBeDefined();
      expect(logger).toBeInstanceOf(ContextLogger);
    });

    test('TC-015: should cache instances by fileName-methodName', () => {
      const a = ContextLogger.for({ fileName: 'cache-test.ts', methodName: 'fn1' });
      const b = ContextLogger.for({ fileName: 'cache-test.ts', methodName: 'fn1' });
      expect(a).toBe(b);
    });

    test('TC-016: should return different instances for different opts', () => {
      const a = ContextLogger.for({ fileName: 'a.ts', methodName: 'fn' });
      const b = ContextLogger.for({ fileName: 'b.ts', methodName: 'fn' });
      expect(a).not.toBe(b);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('@logContext decorator', () => {
    test('TC-020: should wrap methods and set execution context', () => {
      let capturedCtx: any = null;

      @logContext()
      class TestService {
        doWork() {
          capturedCtx = getExecutionContext();
          return 'result';
        }
      }

      const svc = new TestService();
      const result = svc.doWork();

      expect(result).toBe('result');
      expect(capturedCtx).not.toBeNull();
      expect(capturedCtx.className).toBe('TestService');
      expect(capturedCtx.methodName).toBe('doWork');
    });

    test('TC-021: should auto-inject contextLogger as a getter', () => {
      @logContext()
      class TestService {
        getLoggerRef() {
          return (this as any).contextLogger;
        }
      }

      const svc = new TestService();
      const logger = svc.getLoggerRef();
      expect(logger).toBeDefined();
      expect(logger).toBeInstanceOf(ContextLogger);
    });

    test('TC-022: should NOT inject contextLogger when autoInject is false', () => {
      @logContext({ autoInject: false })
      class TestService {
        getLoggerRef() {
          return (this as any).contextLogger;
        }
      }

      const svc = new TestService();
      expect(svc.getLoggerRef()).toBeUndefined();
    });

    test('TC-023: contextLogger getter should override constructor-set property (BaseHelper compat)', () => {
      // Simulate BaseHelper setting this.contextLogger in constructor
      class FakeBaseHelper {
        contextLogger: any;
        constructor() {
          this.contextLogger = { fake: true };
        }
      }

      @logContext()
      class TestService extends FakeBaseHelper {
        getLoggerRef() {
          return this.contextLogger;
        }
      }

      const svc = new TestService();
      const logger = svc.getLoggerRef();

      // Should be ContextLogger, NOT the { fake: true } from FakeBaseHelper
      expect(logger).toBeInstanceOf(ContextLogger);
      expect((logger as any).fake).toBeUndefined();
    });

    test('TC-024: should skip getters/setters on prototype', () => {
      let isGetterCalled = false;

      @logContext()
      class TestService {
        get myProp() {
          isGetterCalled = true;
          return 42;
        }

        doWork() {
          return this.myProp;
        }
      }

      const svc = new TestService();
      const result = svc.doWork();

      // Getter should still work normally (not wrapped by logContext)
      expect(result).toBe(42);
      expect(isGetterCalled).toBe(true);
    });

    test('TC-025: should preserve method name', () => {
      @logContext()
      class TestService {
        mySpecificMethod() {
          return true;
        }
      }

      // When autoInject is true, the decorator returns a wrapped class.
      // The method is on the original prototype — walk the chain.
      let proto = TestService.prototype;
      let descriptor: PropertyDescriptor | undefined;
      while (proto && !descriptor) {
        descriptor = Object.getOwnPropertyDescriptor(proto, 'mySpecificMethod');
        if (!descriptor) {
          proto = Object.getPrototypeOf(proto);
        }
      }

      expect(descriptor).toBeDefined();
      expect(descriptor?.value?.name).toBe('mySpecificMethod');
    });

    test('TC-026: AsyncLocalStorage isolation — concurrent calls should not leak', async () => {
      const contexts: any[] = [];

      @logContext()
      class TestService {
        async methodA() {
          await new Promise(r => setTimeout(r, 10));
          contexts.push(getExecutionContext());
        }

        async methodB() {
          await new Promise(r => setTimeout(r, 5));
          contexts.push(getExecutionContext());
        }
      }

      const svc = new TestService();

      // Run concurrently
      await Promise.all([svc.methodA(), svc.methodB()]);

      expect(contexts).toHaveLength(2);

      const ctxA = contexts.find(c => c?.methodName === 'methodA');
      const ctxB = contexts.find(c => c?.methodName === 'methodB');

      expect(ctxA).toBeDefined();
      expect(ctxA.className).toBe('TestService');
      expect(ctxB).toBeDefined();
      expect(ctxB.className).toBe('TestService');
      // No leaking: each got its own context
      expect(ctxA.methodName).toBe('methodA');
      expect(ctxB.methodName).toBe('methodB');
    });

    test('TC-027: should not wrap constructor as a regular method', () => {
      let isConstructorWrapped = false;

      @logContext()
      class TestService {
        constructor() {
          // If constructor was wrapped, getExecutionContext would return
          // { className: 'TestService', methodName: 'constructor' }
          const ctx = getExecutionContext();
          if (ctx?.methodName === 'constructor') {
            isConstructorWrapped = true;
          }
        }

        doWork() {
          return true;
        }
      }

      new TestService();
      expect(isConstructorWrapped).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('@logContext — static methods', () => {
    test('TC-030: should wrap static methods and set execution context', () => {
      let capturedCtx: any = null;

      @logContext()
      class TestService {
        static doStaticWork() {
          capturedCtx = getExecutionContext();
          return 'static-result';
        }
      }

      const result = TestService.doStaticWork();

      expect(result).toBe('static-result');
      expect(capturedCtx).not.toBeNull();
      expect(capturedCtx.className).toBe('TestService');
      expect(capturedCtx.methodName).toBe('doStaticWork');
    });

    test('TC-031: should provide logger via getContextLogger() in static methods', () => {
      let capturedLogger: any = null;

      @logContext()
      class TestService {
        static doStaticWork() {
          capturedLogger = getContextLogger();
          return true;
        }
      }

      TestService.doStaticWork();

      expect(capturedLogger).toBeDefined();
      expect(capturedLogger).toBeInstanceOf(ContextLogger);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('withLogContext — standalone functions', () => {
    test('TC-040: should wrap standalone function with execution context', () => {
      let capturedCtx: any = null;

      const processPayment = withLogContext(
        { className: 'PaymentUtils', methodName: 'processPayment' },
        (amount: number) => {
          capturedCtx = getExecutionContext();
          return amount * 2;
        },
      );

      const result = processPayment(100);

      expect(result).toBe(200);
      expect(capturedCtx).not.toBeNull();
      expect(capturedCtx.className).toBe('PaymentUtils');
      expect(capturedCtx.methodName).toBe('processPayment');
    });

    test('TC-041: should preserve function name', () => {
      const wrapped = withLogContext(
        { className: 'Utils', methodName: 'myNamedFn' },
        function originalFn() {
          return true;
        },
      );

      expect(wrapped.name).toBe('myNamedFn');
    });

    test('TC-042: should work with async functions', async () => {
      let capturedCtx: any = null;

      const asyncProcessor = withLogContext(
        { className: 'AsyncUtils', methodName: 'process' },
        async (value: string) => {
          await new Promise(r => setTimeout(r, 5));
          capturedCtx = getExecutionContext();
          return `processed-${value}`;
        },
      );

      const result = await asyncProcessor('test');

      expect(result).toBe('processed-test');
      expect(capturedCtx).not.toBeNull();
      expect(capturedCtx.className).toBe('AsyncUtils');
      expect(capturedCtx.methodName).toBe('process');
    });

    test('TC-043: should forward multiple arguments correctly', () => {
      const concat = withLogContext({ methodName: 'concat' }, (a: string, b: string, c: string) => {
        return `${a}-${b}-${c}`;
      });

      expect(concat('x', 'y', 'z')).toBe('x-y-z');
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('@logContext — singleton behavior', () => {
    test('TC-050: singleton instance should isolate context across concurrent calls', async () => {
      const contexts: any[] = [];

      @logContext()
      class SingletonService {
        async handleRequest(id: string) {
          await new Promise(r => setTimeout(r, Math.random() * 10));
          contexts.push({ id, ctx: getExecutionContext() });
        }
      }

      // Simulate singleton: one instance, multiple concurrent calls
      const singleton = new SingletonService();

      await Promise.all([
        singleton.handleRequest('req-1'),
        singleton.handleRequest('req-2'),
        singleton.handleRequest('req-3'),
      ]);

      expect(contexts).toHaveLength(3);

      // All contexts should have the same className and methodName
      for (const entry of contexts) {
        expect(entry.ctx.className).toBe('SingletonService');
        expect(entry.ctx.methodName).toBe('handleRequest');
      }
    });
  });
});
