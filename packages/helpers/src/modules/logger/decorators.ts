import { IExecutionContext } from '@/common';
import { runWithExecutionContext } from './context-aware-logger/context-helper';
import { getContextAwareLogger } from './context-aware-logger/context-aware-logger';

/**
 * @logContext - Class decorator for automatic execution context capture and logger injection
 * Decorator runs ONCE at class definition time (no overhead)
 * And yes, I was mimicking Java's SLF4J
 *
 * WHAT IT DOES:
 * 1. Wraps all methods to capture className and methodName
 * 2. Stores context in AsyncLocalStorage (thread-safe)
 * 3. Auto-injects this.logger property (optional, default: true)
 *
 * WHY ASYNC LOCAL STORAGE:
 * - Thread-safe: Each request/job has isolated storage
 * - Works with singletons: Context is per-execution, not per-instance
 * - No race conditions: Request 1 and Request 2 can't interfere
 *
 * @param opts Options object
 * @param opts.fileName Optional file name to include in context
 * @param opts.autoInject Auto-inject logger property (default: true)
 *
 * @example
 * @logContext()
 * class UserService implements WithLogger {
 *   // this.logger is automatically available!
 *   async createUser() {
 *     this.logger.info('Creating user');
 *     // [UserService][createUser] Creating user
 *   }
 * }
 */
export function logContext(opts?: { fileName?: string; autoInject?: boolean }) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    const className = constructor.name;
    const fileName = opts?.fileName;
    const autoInject = opts?.autoInject ?? true;

    // ────────────────────────────────────────────────────────────
    // STEP 1: Wrap all methods to capture execution context
    // ────────────────────────────────────────────────────────────
    const propertyNames = Object.getOwnPropertyNames(constructor.prototype);

    propertyNames.forEach(propertyName => {
      // Skip constructor
      if (propertyName === 'constructor') {
        return;
      }

      // Skip logger property if auto-injecting (we'll define it separately)
      if (autoInject && propertyName === 'logger') {
        return;
      }

      const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, propertyName);
      if (!descriptor || typeof descriptor.value !== 'function') {
        return;
      }

      const originalMethod = descriptor.value;

      // Wrap method to run within execution context
      descriptor.value = function (this: any, ...args: any[]) {
        // Store context in AsyncLocalStorage
        const context: IExecutionContext = {
          className,
          methodName: propertyName,
          fileName,
        };

        // Run original method within this context
        // - Stores context in AsyncLocalStorage for this async execution
        // - Context is available anywhere in the call stack
        // - Automatically cleaned up when method completes
        return runWithExecutionContext(context, () => {
          return originalMethod.apply(this, args);
        });
      };

      // Apply wrapped method back to prototype
      Object.defineProperty(constructor.prototype, propertyName, descriptor);
    });

    // ────────────────────────────────────────────────────────────
    // STEP 2: Auto-inject logger property (if enabled)
    // ────────────────────────────────────────────────────────────
    if (autoInject) {
      // Check if logger property already exists (e.g., from parent class)
      const hasLogger = 'logger' in constructor.prototype;

      if (!hasLogger) {
        // Define logger as a getter that returns context-aware logger
        // - Logger is created on-demand (lazy)
        // - Always returns logger with current execution context
        // - No need to cache logger per instance
        Object.defineProperty(constructor.prototype, 'logger', {
          get() {
            // Each access returns a logger with current execution context
            return getContextAwareLogger();
          },
          configurable: true,
          enumerable: false, // Don't show in Object.keys()
        });
      }
    }

    return constructor;
  };
}
