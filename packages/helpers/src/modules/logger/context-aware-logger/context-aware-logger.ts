import type { IExecutionContext } from '@/common';
import { Environment } from '@/helpers/env';
import { toBoolean } from '@/utilities';
import type { Logger as WLogger } from 'winston';
import { Logger } from '../application-logger';
import { applicationLogger } from '../default-logger';
import { TLogLevel } from '../types';
import { getExecutionContext, getRequestContext } from './context-helper';

const extraLogEnvs =
  (process.env.APP_ENV_EXTRA_LOG_ENVS ?? '').split(',').map(el => el.trim()) ?? [];
const LOG_ENVIRONMENTS = new Set([...Array.from(Environment.COMMON_ENVS), ...extraLogEnvs]);
const isDebugEnabled = toBoolean(process.env.DEBUG);
const CURRENT_ENV = process.env.NODE_ENV;
const shouldLogDebug = isDebugEnabled && (!CURRENT_ENV || LOG_ENVIRONMENTS.has(CURRENT_ENV));

// ---------------------------------------------------------------------
/**
 * ContextAwareLogger - Automatically includes execution and request context in logs
 *
 * // Usage:
 * this.logger.info('Creating user');
 * // HTTP: [UserService][createUser][abc123 (requestId)] Creating user
 * // Job:  [UserService][createUser] Creating user
 */
export class ContextAwareLogger extends Logger {
  private readonly executionContext: IExecutionContext | null;

  private constructor(scope: string, winstonLogger: WLogger, execCtx: IExecutionContext | null) {
    super(scope, winstonLogger);
    this.executionContext = execCtx;
  }

  private static contextCache = new Map<string, ContextAwareLogger>();

  /**
   * Get or create a ContextAwareLogger for the current execution context
   *
   * FLOW:
   * 1. Get execution context from AsyncLocalStorage
   * 2. Build cache key: className-m
   * ethodName. Fetch from cache. If found return the cached
   * 3. On each log call, instance dynamically fetches requestId
   *
   * @returns ContextAwareLogger instance (cached)
   */
  static override get(): ContextAwareLogger {
    const execCtx = getExecutionContext();

    const scopeParts: string[] = [];

    if (execCtx?.className) {
      scopeParts.push(execCtx.className);
    }

    if (execCtx?.methodName) {
      scopeParts.push(execCtx.methodName);
    }

    const cacheKey = scopeParts.length > 0 ? scopeParts.join('-') : 'default';

    const cached = this.contextCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const newInstance = new ContextAwareLogger(cacheKey, applicationLogger, execCtx);

    this.contextCache.set(cacheKey, newInstance);

    return newInstance;
  }

  /**
   * Build dynamic prefix including request context
   *
   * FORMAT: [className][methodName][requestId]
   *
   * @returns Formatted prefix string
   */
  private buildDynamicPrefix(): string {
    const parts: string[] = [];

    if (this.executionContext?.className) {
      parts.push(this.executionContext.className);
    }

    if (this.executionContext?.methodName) {
      parts.push(this.executionContext.methodName);
    }

    const reqCtx = getRequestContext();

    if (reqCtx?.requestId) {
      parts.push(`${reqCtx.requestId}`);
    }

    return parts.length > 0 ? `[${parts.join('][')}] ` : '';
  }

  // ---------------------------------------------------------------------------
  override info(message: string, ...args: any[]) {
    const prefix = this.buildDynamicPrefix();
    this._logger.info(prefix + message, ...args);
  }

  // ---------------------------------------------------------------------------
  override debug(message: string, ...args: any[]) {
    if (!shouldLogDebug) {
      return;
    }

    const prefix = this.buildDynamicPrefix();
    this._logger.debug(prefix + message, ...args);
  }

  // ---------------------------------------------------------------------------
  override warn(message: string, ...args: any[]) {
    const prefix = this.buildDynamicPrefix();
    this._logger.warn(prefix + message, ...args);
  }

  // ---------------------------------------------------------------------------
  override error(message: string, ...args: any[]) {
    const prefix = this.buildDynamicPrefix();
    this._logger.error(prefix + message, ...args);
  }

  // ---------------------------------------------------------------------------
  override emerg(message: string, ...args: any[]) {
    const prefix = this.buildDynamicPrefix();
    this._logger.emerg(prefix + message, ...args);
  }

  // ---------------------------------------------------------------------------
  override log(level: TLogLevel, message: string, ...args: any[]) {
    const prefix = this.buildDynamicPrefix();
    this._logger.log(level, prefix + message, ...args);
  }

  // ---------------------------------------------------------------------------
  /**
   * Put here for backward compatibility with Logger class.
   * Should not be used when use ContextAwareLogger
   */
  override for(methodName: string): ContextAwareLogger {
    // Build extended execution context
    const extendedContext: IExecutionContext = {
      className: this.executionContext?.className,
      methodName: this.executionContext?.methodName
        ? `${this.executionContext.methodName}-${methodName}`
        : methodName,
      fileName: this.executionContext?.fileName,
    };

    const scope = [this.executionContext?.className, extendedContext.methodName]
      .filter(Boolean)
      .join('-');

    return new ContextAwareLogger(scope, applicationLogger, extendedContext);
  }
}

// ---------------------------------------------------------------------------
/**
 * This is a shorthand for ContextAwareLogger.get()
 */
export const getContextAwareLogger = (): ContextAwareLogger => {
  return ContextAwareLogger.get();
};
