// Usage example:
//   import { logger } from './utils/logUtil';
//   logger.log('hello', someVar);
//   logger.warn('something unexpected', details);
//   logger.error('something failed', err);

export const logger = {
    // eslint-disable-next-line no-console
    log: (...args: unknown[]) => console.log(...args),
    // eslint-disable-next-line no-console
    warn: (...args: unknown[]) => console.warn(...args),
    // eslint-disable-next-line no-console
    error: (...args: unknown[]) => console.error(...args),
    // eslint-disable-next-line no-console
    info: (...args: unknown[]) => console.info(...args),
    // eslint-disable-next-line no-console
    debug: (...args: unknown[]) => console.debug(...args),
};
