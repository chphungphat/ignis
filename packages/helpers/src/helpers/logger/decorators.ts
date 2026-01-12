import 'reflect-metadata';

import { HTTP, IExecutionContext, IRequestContext } from '@/common';
import { tryGetContext } from 'hono/context-storage';

// The key is the instance of class itself
// Using WeakMap to ensure the key-value be able to be garbage collected
// once the class being terminated (like class with scope = TRANSIENT), prevent memory leak
// Why not just object? Because the instance reference is diffrent for each requst
// but javascript treat them as equal if use as key in object
// leading to the second request might override the first requets context
const executionContextMap = new WeakMap<any, IExecutionContext>();

/**
 * Class Decorator
 * ─────────────────────────────────────────────────────────
 *
 * Automatically wraps all methods in a class to capture execution context.
 * This decorator runs ONCE when the class is defined (not on every method call).
 *
 * HOW IT WORKS:
 *
 * 1. Decorator receives the constructor function
 * 2. Iterates through all prototype methods
 * 3. Wraps each method to set context BEFORE execution
 * 4. Context is stored in WeakMap with instance as key
 * 5. Original method executes with context available
 * 6. Context is restored/cleaned after method completes
 *
 *
 * @example
 * ```typescript
 * @logContext()
 * class UserService {
 *   createUser() {
 *     // When this executes, executionContextMap has:
 *     // { className: 'UserService', methodName: 'createUser' }
 *   }
 * }
 * ```
 */
export function logContext(opts: { fileName?: string }) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    const className = constructor.name;
    const fileName = opts?.fileName;

    const propertyNames = Object.getOwnPropertyNames(constructor.prototype);

    propertyNames.forEach(propertyName => {
      if (propertyName === 'constructor') {
        return;
      }

      const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, propertyName);
      if (!descriptor || typeof descriptor.value !== 'function') {
        return;
      }

      const originalMethod = descriptor.value;

      // When a method being invoked
      descriptor.value = function (this: any, ...args: any[]) {
        const previousContext = executionContextMap.get(this);

        executionContextMap.set(this, {
          className,
          methodName: propertyName,
          fileName,
        });

        try {
          // execute original method
          return originalMethod.apply(this, args);
        } finally {
          // Restore previous context in case of chain execution
          if (previousContext) {
            executionContextMap.set(this, previousContext);
          } else {
            executionContextMap.delete(this);
          }
        }
      };

      Object.defineProperty(constructor.prototype, propertyName, descriptor);
    });

    return constructor;
  };
}

// --------------------------------------------------------------------------
/**
 * Retrieves the current execution context for a class instance.
 *
 * CALLED BY:
 * - Logger._getCallerInfo() on every log call
 *
 * @param instance - The class instance (this)
 * @returns Context object or null
 */
export function getlogContext(instance?: any): IExecutionContext | null {
  if (!instance) {
    return null;
  }

  return executionContextMap.get(instance) ?? null;
}

// --------------------------------------------------------------------------
/**
 * Checks if an instance has logging context without retrieving it.
 *
 * @param instance - The class instance
 * @returns true if context exists
 */
export function haslogContext(instance?: any): boolean {
  if (!instance) {
    return false;
  }

  return executionContextMap.has(instance);
}

// --------------------------------------------------------------------------
/**
 * Manually clears context for an instance.
 *
 * @param instance - The class instance
 */
export function clearlogContext(instance: any): void {
  executionContextMap.delete(instance);
}

// --------------------------------------------------------------------------
export function getRequestContext(): IRequestContext | null {
  const context = tryGetContext();

  if (!context) {
    return null;
  }

  const requestId = context.req.header(HTTP.Headers.REQUEST_TRACING_ID);
  const route = context.req.path;
  const method = context.req.method;

  return {
    requestId,
    route,
    method,
  };
}
