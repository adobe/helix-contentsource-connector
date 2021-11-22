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
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Cache plugin for MSAL
 * @class MemCachePlugin
 * @implements ICachePlugin
 */
export default class S3CachePlugin {
  constructor(context, { key }) {
    const { log, env } = context;
    this.log = log;
    this.key = key;
    const opts = !env.AWS_S3_ACCESS_KEY_ID ? {} : {
      region: env.AWS_S3_REGION,
      credentials: {
        accessKeyId: env.AWS_S3_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_S3_SECRET_ACCESS_KEY,
      },
    };
    this.s3 = new S3Client(opts);
  }

  async beforeCacheAccess(cacheContext) {
    try {
      this.log.info('s3: >>> read token cache', this.key);
      const res = await this.s3.send(new GetObjectCommand({
        Bucket: 'helix-content-bus',
        Key: this.key,
      }));
      cacheContext.tokenCache.deserialize(res.Body);
      return true;
    } catch (e) {
      // eslint-disable-next-line no-console
      this.log.warn('s3: unable to deserialize token cache', e);
    }
    return false;
  }

  async afterCacheAccess(cacheContext) {
    if (cacheContext.cacheHasChanged) {
      try {
        this.log.info('s3: >>> write token cache', this.key);
        await this.s3.send(new PutObjectCommand({
          Bucket: 'helix-content-bus',
          Key: this.key,
          Body: cacheContext.tokenCache.serialize(),
          ContentType: 'application/json',
        }));
        return true;
      } catch (e) {
        // eslint-disable-next-line no-console
        this.log.warn('s3: unable to serialize token cache', e);
      }
    }
    return false;
  }
}
