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
import { context, timeoutSignal, h1 } from '@adobe/helix-fetch';

/* istanbul ignore next */
export const { fetch } = process.env.HELIX_FETCH_FORCE_HTTP1
  /* istanbul ignore next */ ? h1()
  /* istanbul ignore next */ : context();

/**
 * Returns fetch compatible options with the common headers set
 * @param {UniversalContext} ctx the context
 * @param {object} opts additional fetch options
 * @return {object} fetch options.
 */
export function getFetchOptions(ctx, opts) {
  const fetchopts = {
    headers: {
      'cache-control': 'no-cache', // respected by runtime
    },
    ...opts,
  };
  if (ctx.requestId) {
    fetchopts.headers['x-request-id'] = ctx.requestId;
  }
  if (ctx.githubToken) {
    fetchopts.headers['x-github-token'] = ctx.githubToken;
  }
  if (opts.fetchTimeout) {
    fetchopts.signal = timeoutSignal(opts.fetchTimeout);
    delete fetchopts.fetchTimeout;
  }
  if (opts.lastModified) {
    fetchopts.headers['if-modified-since'] = opts.lastModified;
    delete fetchopts.lastModified;
  }
  return fetchopts;
}
