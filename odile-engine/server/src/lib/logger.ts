import { pino } from 'pino';
import { config } from '../config.js';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: config.isProd
    ? undefined
    : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
});
