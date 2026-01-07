import 'reflect-metadata';
import { Logger } from './application-logger';
import { Logger as _WLogger } from 'winston';

export function injectLogger(options?: { customLogger?: _WLogger }) {
  return function (target: any, propertyKey: string | symbol) {
    // Store metadata
    Reflect.defineMetadata('logger:property', propertyKey, target);

    Object.defineProperty(target, propertyKey, {
      get(this: any) {
        const logger = new Logger({});
      },
    });
  };
}
