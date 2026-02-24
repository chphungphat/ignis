import 'reflect-metadata';
import { Logger } from './application-logger';
import { getContextAwareLogger } from './context-aware-logger/context-aware-logger';
import { Logger as _WLogger } from 'winston';

/**
 * @injectLogger - Property decorator for manual logger injection
 *
 * NOTE: This decorator is now SIMPLIFIED and OPTIONAL.
 * If you use @logContext() decorator, you DON'T need this!
 *
 * WHEN TO USE:
 * - When you want explicit logger property declaration
 * - When you need custom winston logger
 * - When you can't use @logContext decorator
 *
 * WHEN NOT TO USE:
 * - If your class uses @logContext() - logger is auto-injected!
 * - For new code - prefer @logContext() with auto-injection
 *
 * MIGRATION PATH:
 * Old code (with @injectLogger):
 * ```typescript
 * @logContext()
 * class UserService {
 *   @injectLogger()
 *   private logger!: Logger;
 * }
 * ```
 *
 * New code (without @injectLogger):
 * ```typescript
 * @logContext()
 * class UserService implements WithLogger {
 *   // No @injectLogger needed!
 *   // this.logger is automatically available
 * }
 * ```
 *
 * @param options Options
 * @param options.customLogger Custom winston logger instance
 * @param options.contextAware Use context-aware logger (default: true)
 */
export function injectLogger(options?: { customLogger?: _WLogger; contextAware?: boolean }) {
  return function (target: any, propertyKey: string | symbol) {
    // Store metadata
    Reflect.defineMetadata('logger:property', propertyKey, target);

    const useContextAware = options?.contextAware ?? true;

    Object.defineProperty(target, propertyKey, {
      get(this: any) {
        let logger: Logger;

        if (useContextAware && !options?.customLogger) {
          // Use context-aware logger (recommended)
          // Automatically includes className, methodName, requestId
          logger = getContextAwareLogger() as any;
        } else {
          // Use standard logger (backward compatibility or custom winston)
          // Note: We use the class name as the scope
          const scope = this.constructor?.name ?? 'UnknownClass';
          logger = Logger.get(scope, options?.customLogger);
        }

        // Cache the logger on the instance
        Object.defineProperty(this, propertyKey, {
          value: logger,
          writable: false,
          configurable: false,
          enumerable: false,
        });

        return logger;
      },
      configurable: true,
      enumerable: false,
    });
  };
}

/**
 * Simplified @injectContextAwareLogger decorator
 *
 * This is a convenience decorator that explicitly injects a context-aware logger.
 * Equivalent to @injectLogger({ contextAware: true })
 *
 * NOTE: If you use @logContext(), you don't need this!
 *
 * @example
 * class UserService {
 *   @injectContextAwareLogger()
 *   private logger!: ContextAwareLogger;
 *
 *   async createUser() {
 *     this.logger.info('Creating user');
 *     // [UserService][createUser][req-abc123] Creating user
 *   }
 * }
 */
export function injectContextAwareLogger() {
  return injectLogger({ contextAware: true });
}
