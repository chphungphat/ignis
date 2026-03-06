import { IExecutionContext } from '@/common';
import { toBoolean } from '@/utilities/parse.utility';
import { Logger } from 'winston';
import { getExecutionContext, getRequestContext } from '../context';
import { Environment } from '../env/app-env';
import { applicationLogger } from './default-logger';
import { TLogLevel } from './types';

const extraLogEnvs =
  (process.env.APP_ENV_EXTRA_LOG_ENVS ?? '').split(',').map(el => el.trim()) ?? [];
const LOG_ENVIRONMENTS = new Set([...Array.from(Environment.COMMON_ENVS), ...extraLogEnvs]);
const isDebugEnabled = toBoolean(process.env.DEBUG);
const CURRENT_ENV = process.env.NODE_ENV;
const shouldLogDebug = isDebugEnabled && (!CURRENT_ENV || LOG_ENVIRONMENTS.has(CURRENT_ENV));

export class ContextLogger {
  private static cache = new Map<string, ContextLogger>();

  private readonly executionContext: IExecutionContext | null;
  private readonly logger: Logger;

  protected constructor(context: IExecutionContext | null, logger: Logger) {
    this.executionContext = context;
    this.logger = logger;
  }

  // ---------------------------------------------------------------------
  static get(): ContextLogger {
    const context = getExecutionContext();

    const cacheKeyParts: string[] = [];

    if (context?.className) {
      cacheKeyParts.push(context.className);
    }

    if (context?.methodName) {
      cacheKeyParts.push(context.methodName);
    }

    const cacheKey = cacheKeyParts.length > 0 ? cacheKeyParts.join('-') : 'default';

    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const newInstance = new ContextLogger(context, applicationLogger);

    this.cache.set(cacheKey, newInstance);

    return newInstance;
  }

  // ---------------------------------------------------------------------
  static for(opts?: { methodName?: string; fileName?: string }): ContextLogger {
    const context = getExecutionContext();

    const cacheKeyParts: string[] = [];

    if (opts?.fileName) {
      cacheKeyParts.push(opts.fileName);
    }

    if (opts?.methodName) {
      cacheKeyParts.push(opts.methodName);
    }

    const cacheKey = cacheKeyParts.length > 0 ? cacheKeyParts.join('-') : 'default';

    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const newInstance = new ContextLogger(
      { ...context, methodName: opts?.methodName, fileName: opts?.fileName },
      applicationLogger,
    );

    this.cache.set(cacheKey, newInstance);

    return newInstance;
  }

  // ---------------------------------------------------------------------
  info(message: string, ...args: any[]) {
    this.logger.info(this.buildDynamicPrefix() + message, ...args);
  }

  // ---------------------------------------------------------------------
  debug(message: string, ...args: any[]) {
    if (!shouldLogDebug) {
      return;
    }

    this.logger.debug(this.buildDynamicPrefix() + message, ...args);
  }

  // ---------------------------------------------------------------------
  warn(message: string, ...args: any[]) {
    this.logger.warn(this.buildDynamicPrefix() + message, ...args);
  }

  // ---------------------------------------------------------------------
  error(message: string, ...args: any[]) {
    this.logger.error(this.buildDynamicPrefix() + message, ...args);
  }

  // ---------------------------------------------------------------------
  emerg(message: string, ...args: any[]) {
    this.logger.emerg(this.buildDynamicPrefix() + message, ...args);
  }

  // ---------------------------------------------------------------------
  log(level: TLogLevel, message: string, ...args: any[]) {
    this.logger.log(level, this.buildDynamicPrefix() + message, ...args);
  }

  // ---------------------------------------------------------------------
  private buildDynamicPrefix(): string {
    const parts: string[] = [];

    if (this.executionContext?.className) {
      parts.push(this.executionContext.className);
    } else if (this.executionContext?.fileName) {
      parts.push(this.executionContext.fileName);
    }

    if (this.executionContext?.methodName) {
      parts.push(this.executionContext.methodName);
    }

    const requestContext = getRequestContext();

    if (requestContext?.requestId) {
      parts.push(requestContext.requestId);
    }

    return parts.length > 0 ? `[${parts.join('][')}]` : '';
  }
}

// ---------------------------------------------------------------------
export const getContextLogger = (): ContextLogger => {
  return ContextLogger.get();
};

// ---------------------------------------------------------------------
export const getContextLoggerForMethod = (opts?: {
  methodName?: string;
  fileName?: string;
}): ContextLogger => {
  return ContextLogger.for(opts);
};
