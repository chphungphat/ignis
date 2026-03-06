import { IExecutionContext } from '@/common/types';
import { getContextLogger } from './context-logger';
import { runWithExecutionContext } from '../context/execution-context';

const STATIC_BUILTINS = new Set(['length', 'name', 'prototype', 'arguments', 'caller']);

export function logContext(opts?: { fileName?: string; autoInject?: boolean }) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    const className = constructor.name;
    const fileName = opts?.fileName;
    const autoInject = opts?.autoInject ?? true;

    // STEP 1: wrap all methods to capture method name
    const propertyNames = Object.getOwnPropertyNames(constructor.prototype);

    for (const propertyName of propertyNames) {
      if (propertyName === 'constructor') {
        continue;
      }

      const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, propertyName);

      if (
        !descriptor ||
        descriptor.get ||
        descriptor.set ||
        typeof descriptor.value !== 'function'
      ) {
        continue;
      }

      const originalMethod = descriptor.value;

      const wrappedMethod = function (this: any, ...args: any[]) {
        const context: IExecutionContext = { className, methodName: propertyName, fileName };
        return runWithExecutionContext(context, () => originalMethod.apply(this, args));
      };

      Object.defineProperty(wrappedMethod, 'name', { value: originalMethod.name || propertyName });
      Object.defineProperty(constructor.prototype, propertyName, {
        ...descriptor,
        value: wrappedMethod,
      });
    }

    // STEP 2: wrap static methods
    const staticNames = Object.getOwnPropertyNames(constructor);

    for (const staticName of staticNames) {
      if (STATIC_BUILTINS.has(staticName)) {
        continue;
      }

      const descriptor = Object.getOwnPropertyDescriptor(constructor, staticName);

      if (
        !descriptor ||
        descriptor.get ||
        descriptor.set ||
        typeof descriptor.value !== 'function'
      ) {
        continue;
      }

      const originalMethod = descriptor.value;

      const wrappedMethod = function (this: any, ...args: any[]) {
        const context: IExecutionContext = { className, methodName: staticName, fileName };
        return runWithExecutionContext(context, () => originalMethod.apply(this, args));
      };

      Object.defineProperty(wrappedMethod, 'name', { value: originalMethod.name || staticName });
      Object.defineProperty(constructor, staticName, {
        ...descriptor,
        value: wrappedMethod,
      });
    }

    // STEP 3: Wrap constructor to inject contextLogger
    if (!autoInject) {
      return constructor;
    }

    const wrapped = class extends constructor {
      constructor(...args: any[]) {
        super(...args);

        // name it 'contextLogger' to prevent conflict with `logger` from BaseHelper
        Object.defineProperty(this, 'contextLogger', {
          get() {
            return getContextLogger();
          },
          configurable: true,
          enumerable: false,
        });
      }
    };

    Object.defineProperty(wrapped, 'name', { value: className });

    return wrapped as unknown as T;
  };
}
