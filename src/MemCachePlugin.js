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

/**
 * Cache plugin for MSAL
 * @class MemCachePlugin
 * @implements ICachePlugin
 */
export default class MemCachePlugin {
  async beforeCacheAccess(cacheContext) {
    const { cache } = this;
    try {
      if (cache) {
        cacheContext.tokenCache.deserialize(cache);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log('unable to deserialize', e);
    }
  }

  async afterCacheAccess(cacheContext) {
    if (cacheContext.cacheHasChanged) {
      this.cache = cacheContext.tokenCache.serialize();
    }
  }
}
