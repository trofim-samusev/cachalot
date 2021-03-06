import defaultsDeep from 'lodash/defaultsDeep';
import { ConnectionStatus } from './connection-status';
import { Executor, ValueOfExecutor } from './executor';
import { ReadWriteOptions, Storage, StorageRecordValue, WriteOptions } from './storage';
import { StorageAdapter } from './storage-adapter';
import { BaseStorage } from './storages/base';
import { Logger } from './logger';
import { Manager } from './manager';
import RefreshAheadManager from './managers/refresh-ahead';
import { BaseManager, ManagerOptions } from './managers/base';
import { EXPIRES_IN } from './constants';

export interface CacheWithCustomStorageOptions {
  storage: Storage;
}
export interface CacheWithBaseStorageOptions {
  adapter: StorageAdapter;
}
export interface ManagerConstructor<T extends BaseManager = any> {
  new(options: ManagerOptions): T;
  getName(): string;
}
export type CacheOptions = (CacheWithCustomStorageOptions | CacheWithBaseStorageOptions) & {
  logger: Logger;
  expiresIn?: number;
  prefix?: string;
  hashKeys?: boolean;
};
export const isCustomStorageOptions = (options: any): options is CacheWithCustomStorageOptions =>
  Boolean(options.storage);
export const isBaseStorageOptions = (options: any): options is CacheWithBaseStorageOptions =>
  Boolean(options.adapter) && !Boolean(options.storage);
export interface ManagerSelectorOptions {
  manager?: string;
}

/**
 * Cache is the basic class of CacheManager.
 * @example
 *
 * ```typescript
 * // cache.ts
 * import logger from './logger';
 * import Cache, { RedisStorageAdapter } from 'cachalot';
 *
 * const redis = new Redis();
 *
 * export const cache = new Cache({
 *   adapter: new RedisStorageAdapter(redisClient),
 *   logger,
 * });
 *  ```
 */
class Cache {
  constructor(options: CacheOptions) {
    if (isCustomStorageOptions(options)) {
      this.storage = options.storage;
    }

    if (isBaseStorageOptions(options)) {
      this.storage = new BaseStorage({
        adapter: options.adapter,
        prefix: options.prefix,
        hashKeys: options.hashKeys
      });
    }

    if (!this.storage) {
      throw new Error('Either custom storage or storage adapter must be passed in options.');
    }

    if (!options.logger) {
      throw new Error('Logger is required.');
    }

    this.logger = options.logger;
    this.expiresIn = options.expiresIn || EXPIRES_IN.day;

    this.managers = new Map();
    this.registerManager(RefreshAheadManager);
  }

  private storage: Storage;
  private logger: Logger;
  private expiresIn: number;
  private managers: Map<string, Manager>;

  /**
   * Get delegates call to default or provided manager. The only thing it does by itself is checking
   * the connection status of storage. If storage is disconnected calls executor directly and returns result.
   */
  public async get<E extends Executor>(key: string, executor: E, options: ReadWriteOptions & ManagerSelectorOptions = {}):
    Promise<ValueOfExecutor<E>> {
    const connectionStatus = this.storage.getConnectionStatus();

    if (connectionStatus !== ConnectionStatus.CONNECTED) {
      this.logger.error(`Storage connection status is "${connectionStatus}", cache is unavailable!. Running executor.`);

      return executor();
    }

    const { manager: managerName = RefreshAheadManager.getName() } = options;
    const computedOptions = defaultsDeep({}, options, { expiresIn: this.expiresIn });
    const manager = this.getManager(managerName);

    return manager.get(key, executor, computedOptions);
  }

  /**
   * Just like "get" this method delegates call to default or provided manager
   */
  public async set(key: string, value: StorageRecordValue, options: WriteOptions & ManagerSelectorOptions = {}): Promise<any> {
    const { manager: managerName = RefreshAheadManager.getName() } = options;
    const computedOptions = defaultsDeep({}, options, { expiresIn: this.expiresIn });
    const manager = this.getManager(managerName);

    return manager.set(key, value, computedOptions);
  }

  /**
   * The touch method is intended for all cases when you need to inform the cache manager that the data for
   * any tags are updated without making a cache entry;
   *
   * @example
   *
   * ```typescript
   * await saveNews(news);
   * cache.touch(['news']);
   * ```
   */
  public async touch(tags: string[]): Promise<any> {
    return this.storage.touch(tags);
  }

  /**
   * Register a new cache manager
   */
  public registerManager(managerClass: ManagerConstructor, name?: string | null, options: Partial<ManagerOptions> = {}): void {
    this.managers.set(name || managerClass.getName(), new managerClass({
      logger: this.logger,
      storage: this.storage,
      ...options
    }));
  }

  /**
   * Returns cache manager by its name
   */
  private getManager(name: string): Manager {
    const manager = this.managers.get(name);

    if (!manager) {
      throw new Error(`Unknown manager "${name}"`);
    }

    return manager;
  }
}

export default Cache;
