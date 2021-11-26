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
import { google } from 'googleapis';
import GoogleTokenCache from './GoogleTokenCache.js';

/**
 * Google auth client
 */
export default class GoogleClient {
  /**
   *
   * @param {ICachePlugin} plugin
   */
  constructor(opts) {
    this.log = opts.log;
    this.client = new google.auth.OAuth2(
      opts.clientId,
      opts.clientSecret,
      opts.redirectUri,
    );
    this.cache = new GoogleTokenCache(opts.plugin).withLog(opts.log);

    /// hack to capture tokens, since the emit handler is not awaited in the google client
    const originalRefreshTokenNoCache = this.client.refreshTokenNoCache.bind(this.client);
    this.client.refreshTokenNoCache = async (...args) => {
      const ret = await originalRefreshTokenNoCache(...args);
      await this.cache.store(ret.tokens);
      return ret;
    };
  }

  async init() {
    await this.cache.load();
    this.client.setCredentials(this.cache.tokens);
    return this;
  }

  async generateAuthUrl(...args) {
    return this.client.generateAuthUrl(...args);
  }

  async setCredentials(tokens) {
    await this.cache.store(tokens);
    this.client.setCredentials(tokens);
  }

  async getToken(code) {
    const resp = await this.client.getToken(code);
    await this.cache.store(resp.tokens);
    return resp;
  }
}
