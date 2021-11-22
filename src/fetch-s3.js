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
import { promisify } from 'util';
import zlib from 'zlib';
import { Response } from '@adobe/helix-universal';

import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';

const gunzip = promisify(zlib.gunzip);

/**
 * Fetches content from s3
 * @oaram {AdminContext} context the admin context
 * @param {string} bucketId bucket id
 * @param {string} key the resource key
 * @param {boolean} head flag indicating to create a head request
 * @return {Promise<Response>} fetch api response
 */
export default async function fetchS3(context, bucketId, key, head = false) {
  if (!bucketId) {
    throw new Error('Unknown bucketId, cannot fetch content');
  }
  if (!key) {
    throw new Error('Unknown key, cannot fetch content');
  }
  const { log, env = {} } = context;

  try {
    // the client initialization is a bit picky with undefined properties.
    // so we omit the credentials when we provide them via context.env
    const opts = !env.AWS_S3_ACCESS_KEY_ID ? {} : {
      region: env.AWS_S3_REGION,
      credentials: {
        accessKeyId: env.AWS_S3_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_S3_SECRET_ACCESS_KEY,
      },
    };
    const s3 = new S3Client(opts);
    const Command = head ? HeadObjectCommand : GetObjectCommand;
    const res = await s3.send(new Command({
      Bucket: bucketId,
      Key: key,
      // todo: add timeout
    }));

    let buffer = '';
    if (!head) {
      buffer = await new Response(res.Body, {}).buffer();
      if (res.ContentEncoding === 'gzip') {
        buffer = await gunzip(buffer);
      }
    }
    const headers = {};
    if (res.LastModified) {
      headers['last-modified'] = res.LastModified.toUTCString();
    }
    if (res.ContentType) {
      headers['content-type'] = res.ContentType;
    }
    if (res.ContentLength) {
      headers['x-source-content-length'] = res.ContentLength;
    }
    if (res.Metadata) {
      Object.entries(res.Metadata).forEach(([name, value]) => {
        headers[name] = value;
      });
    }
    return new Response(buffer, {
      status: 200,
      headers,
    });
  } catch (e) {
    const code = e.Code || (e.$metadata && e.$metadata.httpStatusCode) || 500;
    if (code === 'AccessDenied' || code === 404) {
      log.info(`Could not find file at ${bucketId}/${key}: ${code}`);
      return new Response('', {
        status: 404,
      });
    } else {
      log.error(`Error while fetching file from ${bucketId}/${key}: ${code} (${e.message})`);
      return new Response('', {
        status: 502,
        headers: {
          'x-error': `error while fetching: ${code}`,
        },
      });
    }
  }
}
