import type { AbusePipeline, CurrencyDriver } from '@faucet/core';
import type { ServerConfig } from './config.js';
import type { Db } from './db/index.js';
import type { EventStream } from './stream.js';
import type { EventRing } from './events.js';

export interface AppContext {
  config: ServerConfig;
  db: Db;
  driver: CurrencyDriver;
  pipeline: AbusePipeline;
  stream: EventStream;
  events: EventRing;
}
