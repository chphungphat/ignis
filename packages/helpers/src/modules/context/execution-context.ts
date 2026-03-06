import { IExecutionContext } from '@/common';
import { AsyncLocalStorage } from 'node:async_hooks';

const executionContextStorage = new AsyncLocalStorage<IExecutionContext>();

// -------------------------------------------------------------------------
/**
 * Store execution context and run function within that context
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
export const getExecutionContext = (): IExecutionContext | null => {
  return executionContextStorage.getStore() ?? null;
};

// -------------------------------------------------------------------------
/**
 * Wrap a standalone function with execution context.
 * The function equivalent of @logContext() for functions that don't belong to a class.
 *
 * @example
 * export const processPayment = withLogContext(
 *   { className: 'PaymentUtils', methodName: 'processPayment' },
 *   async (amount: number) => {
 *     const logger = getContextLogger();
 *     logger.info('Processing: %d', amount);
 *     // [PaymentUtils][processPayment] Processing: 50
 *   }
 * );
 */
export const withLogContext = <TArgs extends any[], TReturn>(
  context: IExecutionContext,
  fn: (...args: TArgs) => TReturn,
): ((...args: TArgs) => TReturn) => {
  const wrapped = (...args: TArgs) => {
    return runWithExecutionContext(context, () => fn(...args));
  };

  Object.defineProperty(wrapped, 'name', { value: context.methodName });

  return wrapped;
};
