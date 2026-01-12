import { HTTP, IExecutionContext, IRequestContext } from '@/common';
import { tryGetContext } from 'hono/context-storage';
import { Env } from 'hono/types';
import { AsyncLocalStorage } from 'node:async_hooks';

const executionContextStorage = new AsyncLocalStorage<IExecutionContext>();

/**
 * Store execution context and run function within that context
 *
 * Called by @logContext decorator to wrap each method
 *
 * @example
 * runWithExecutionContext(
 *   { className: 'UserService', methodName: 'createUser' },
 *   () => originalCreateUser()
 * )
 */
export const runWithExecutionContext = <T>(context: IExecutionContext, fn: () => T) => {
  return executionContextStorage.run(context, fn);
};

// -------------------------------------------------------------------------
/**
 * Get current execution context from AsyncLocalStorage
 *
 * Returns null if:
 * - Called outside decorated method (e.g., global scope)
 * - Called in undecorated class
 * - Called before any method executes
 *
 * @returns Current execution context or null */
export const getExecutionContext = (): IExecutionContext | null => {
  return executionContextStorage.getStore() ?? null;
};

// -------------------------------------------------------------------------
/**
 * @returns Request context or null (if not in HTTP context)
 */
export const getRequestContext = <AppEnv extends Env = Env>(): IRequestContext | null => {
  try {
    const context = tryGetContext<AppEnv>();

    if (!context) {
      return null;
    }

    // Bypass typescript error check
    const requestId =
      ((context as any).get?.('requestId') as string | undefined) ??
      context.req.header(HTTP.Headers.REQUEST_TRACING_ID);

    const route = context.req.path;
    const method = context.req.method;

    return {
      requestId,
      route,
      method,
    };
  } catch {
    // Error accessing context (should not happen, but handle gracefully)
    return null;
  }
};
