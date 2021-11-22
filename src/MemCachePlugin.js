/*
 * Copyright 2021 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
const caches = {};

/**
 * Cache plugin for MSAL
 * @class MemCachePlugin
 * @implements ICachePlugin
 */
export default class MemCachePlugin {
  constructor(context, { key, base }) {
    const { log } = context;
    this.log = log;
    this.key = key;
    this.base = base;
  }

  async beforeCacheAccess(cacheContext) {
    try {
      this.log.info('mem: >>> read token cache', this.key);
      const cache = caches[this.key];
      if (cache) {
        cacheContext.tokenCache.deserialize(cache);
        return true;
      } else if (this.base) {
        this.log.info('mem: >>> read token cache failed. asking base');
        const ret = await this.base.beforeCacheAccess(cacheContext);
        if (ret) {
          this.log.info('mem: >>> base updated. remember.');
          caches[this.key] = cacheContext.tokenCache.serialize();
        }
      }
    } catch (e) {
      this.log.warn('mem: unable to deserialize token cache.', e);
    }
    return false;
  }

  async afterCacheAccess(cacheContext) {
    if (cacheContext.cacheHasChanged) {
      this.log.info('mem: >>> write token cache', this.key);
      caches[this.key] = cacheContext.tokenCache.serialize();
      if (this.base) {
        this.log.info('mem: >>> write token cache done. telling base', this.key);
        return this.base.afterCacheAccess(cacheContext);
      }
      return true;
    }
    return false;
  }
}
