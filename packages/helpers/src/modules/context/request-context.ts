import { HTTP } from '@/common/constants/http';
import { IRequestContext } from '@/common/types';
import { tryGetContext } from 'hono/context-storage';

export const getRequestContext = (): IRequestContext | null => {
  try {
    const context = tryGetContext();

    if (!context) {
      return null;
    }

    // Bypass typescript error check
    // Since the ContextVariableMap was declare at core
    const requestId =
      ((context as any).get('requestId') as string | undefined) ??
      context.req.header(HTTP.Headers.REQUEST_TRACING_ID);

    const path = context.req.path;
    const method = context.req.method;
    const url = context.req.url;

    return {
      requestId,
      path,
      method,
      url,
    };
  } catch {
    return null;
  }
};
