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

import { logLevelForStatusCode, propagateStatusCode } from '@adobe/helix-shared-utils';
import { MountConfig } from '@adobe/helix-shared-config';
import fetchS3 from './fetch-s3.js';
import { fetch } from './utils.js';

/**
 * Checks if the response is valid and returns a mount config.
 *
 * @param {Logger} log logger
 * @param {Response} response content response from the storage
 * @param {string} key storage key (logging information)
 * @param {string} type type of storage (logging information
 * @returns {Promise<MountConfig>} the mount config or null
 */
async function handleResponse(log, response, key, type) {
  const text = await response.text();
  if (response.ok) {
    const cfg = await new MountConfig().withSource(text).init();
    cfg.sourceType = type;
    return cfg;
  }

  if (response.status === 404) {
    log.info(`No fstab.yaml found in ${type} ${key}, ${text}`);
    return null;
  }

  log[logLevelForStatusCode(response.status)](`Invalid response (${response.status}) when fetching fstab from ${type} ${key}`);
  const err = new Error('Unable to fetch fstab', text);
  err.status = propagateStatusCode(response.status);
  throw err;
}

/**
 * Retrieves the fstab from the underlying storage and stores it in the context as mountConfig.
 * @param {AdminContext} ctx the context
 * @param {LookupOptions} opts lookup options
 * @param {boolean} optional if {@code true}, no error is thrown if the fstab can't be retrieved
 * @returns {Promise<MountConfig>} the fstab
 */
export default async function fstab(ctx, opts, optional) {
  if (ctx.mountConfig) {
    return ctx.mountConfig;
  }
  const { log } = ctx;
  const {
    owner, repo, ref, branch,
  } = opts;

  let key = `${owner}/${repo}/${ref}/fstab.yaml`;
  let response = await fetchS3(ctx, 'helix-code-bus', key);
  ctx.mountConfig = await handleResponse(log, response, key, 'code-bus');
  if (ctx.mountConfig) {
    return ctx.mountConfig;
  }

  // try loading from github for non helix-3 repos
  const headers = {};
  key = `${owner}/${repo}/${branch || ref}/fstab.yaml`;
  if (ctx.githubToken) {
    headers.authorization = `token ${ctx.githubToken}`;
  }
  response = await fetch(`https://raw.githubusercontent.com/${key}`, {
    cache: 'no-store',
    headers,
  });
  ctx.mountConfig = await handleResponse(log, response, key, 'github');
  if (ctx.mountConfig) {
    return ctx.mountConfig;
  }

  if (optional) {
    return null;
  }

  throw Error(`no fstab for ${key}`);
}
