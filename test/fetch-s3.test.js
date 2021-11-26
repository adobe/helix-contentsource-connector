/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
/* eslint-env mocha */
import { promisify } from 'util';
import zlib from 'zlib';
import assert from 'assert';
import { Nock } from './utils.js';
import fetchS3 from '../src/fetch-s3.js';

const gzip = promisify(zlib.gzip);

// require('dotenv').config();

const DEFAULT_CONTEXT = {
  log: console,
  env: {
    AWS_S3_REGION: 'us-east-1',
    AWS_S3_ACCESS_KEY_ID: 'fake-key-id',
    AWS_S3_SECRET_ACCESS_KEY: 'fake-secret',
  },
};

describe('fetch-s3 tests', () => {
  let nock;
  beforeEach(() => {
    nock = new Nock();
  });

  afterEach(() => {
    nock.done();
  });

  it('throws error if no bucket id', async () => {
    const task = fetchS3(DEFAULT_CONTEXT);
    await assert.rejects(task, new Error('Unknown bucketId, cannot fetch content'));
  });

  it('throws error if no key', async () => {
    const task = fetchS3(DEFAULT_CONTEXT, 'default-bucket');
    await assert.rejects(task, new Error('Unknown key, cannot fetch content'));
  });

  it('downloads normal content', async () => {
    nock('https://default-bucket.s3.us-east-1.amazonaws.com')
      .get('/live/index.md?x-id=GetObject')
      .reply(200, '# welcome\n', {
        'content-type': 'text/markdown',
        'last-modified': 'Wed, 12 Oct 2009 17:50:00 GMT',
        'x-amz-meta-x-source-location': '/drive/1234/item/5678',
        'x-amz-meta-x-foo-bar': 'test',
      });

    const resp = await fetchS3(DEFAULT_CONTEXT, 'default-bucket', 'live/index.md');

    assert.strictEqual(resp.status, 200);
    assert.strictEqual(await resp.text(), '# welcome\n');
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'text/markdown',
      'last-modified': 'Mon, 12 Oct 2009 17:50:00 GMT',
      'x-source-location': '/drive/1234/item/5678',
      'x-foo-bar': 'test',
    });
  });

  it('performs head command', async () => {
    nock('https://default-bucket.s3.us-east-1.amazonaws.com')
      .head('/live/index.md')
      .reply(200, '', {
        'content-type': 'text/markdown',
        'last-modified': 'Wed, 12 Oct 2009 17:50:00 GMT',
        'x-amz-meta-x-source-location': '/drive/1234/item/5678',
        'x-amz-meta-x-foo-bar': 'test',
      });
    const resp = await fetchS3(DEFAULT_CONTEXT, 'default-bucket', 'live/index.md', true);

    assert.strictEqual(resp.status, 200);
    assert.strictEqual(await resp.text(), '');
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'text/markdown',
      'last-modified': 'Mon, 12 Oct 2009 17:50:00 GMT',
      'x-source-location': '/drive/1234/item/5678',
      'x-foo-bar': 'test',
    });
  });

  it('x-source-last-modified does not override last modified', async () => {
    nock('https://default-bucket.s3.us-east-1.amazonaws.com')
      .get('/live/index.md?x-id=GetObject')
      .reply(200, '# welcome\n', {
        'content-type': 'text/markdown',
        'last-modified': 'Mon, 12 Oct 2009 17:50:00 GMT',
        'x-amz-meta-x-source-last-modified': 'Fri, 07 May 2021 18:03:19 GMT',
      });

    const resp = await fetchS3(DEFAULT_CONTEXT, 'default-bucket', 'live/index.md');

    assert.strictEqual(resp.status, 200);
    assert.strictEqual(await resp.text(), '# welcome\n');
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'text/markdown',
      'last-modified': 'Mon, 12 Oct 2009 17:50:00 GMT',
      'x-source-last-modified': 'Fri, 07 May 2021 18:03:19 GMT',
    });
  });

  it('downloads normal content without headers', async () => {
    nock('https://default-bucket.s3.us-east-1.amazonaws.com')
      .get('/live/index.md?x-id=GetObject')
      .reply(200, '# welcome\n');

    const resp = await fetchS3(DEFAULT_CONTEXT, 'default-bucket', 'live/index.md');

    assert.strictEqual(resp.status, 200);
    assert.strictEqual(await resp.text(), '# welcome\n');
    assert.deepStrictEqual(resp.headers.plain(), {});
  });

  it('downloads gzipped content', async () => {
    const data = await gzip(Buffer.from('# welcome\n', 'utf-8'));
    nock('https://default-bucket.s3.us-east-1.amazonaws.com')
      .get('/live/index.md?x-id=GetObject')
      .reply(200, data, {
        'content-encoding': 'gzip',
        'content-type': 'text/markdown',
        'last-modified': 'Wed, 12 Oct 2009 17:50:00 GMT',
      });

    const resp = await fetchS3(DEFAULT_CONTEXT, 'default-bucket', 'live/index.md');

    assert.strictEqual(resp.status, 200);
    assert.strictEqual(await resp.text(), '# welcome\n');
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'text/markdown',
      'last-modified': 'Mon, 12 Oct 2009 17:50:00 GMT',
    });
  });

  it('downloads sets error on missing content', async () => {
    nock('https://default-bucket.s3.us-east-1.amazonaws.com')
      .get('/live/index.md?x-id=GetObject')
      .reply(404);

    const resp = await fetchS3(DEFAULT_CONTEXT, 'default-bucket', 'live/index.md');

    assert.strictEqual(resp.status, 404);
    assert.strictEqual(await resp.text(), '');
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
    });
  });

  it('downloads sets error on access denied content', async () => {
    nock('https://default-bucket.s3.us-east-1.amazonaws.com')
      .get('/live/index.md?x-id=GetObject')
      .reply(403, '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>');

    const resp = await fetchS3(DEFAULT_CONTEXT, 'default-bucket', 'live/index.md');

    assert.strictEqual(resp.status, 404);
    assert.strictEqual(await resp.text(), '');
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
    });
  });

  it('downloads sets error backend error', async () => {
    nock('https://default-bucket.s3.us-east-1.amazonaws.com')
      .get('/live/index.md?x-id=GetObject')
      .times(3)
      .reply(500);

    const resp = await fetchS3(DEFAULT_CONTEXT, 'default-bucket', 'live/index.md');

    assert.strictEqual(resp.status, 502);
    assert.strictEqual(await resp.text(), '');
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'error while fetching: 500',
    });
  });

  it('downloads sets error for client error', async () => {
    const resp = await fetchS3({
      log: console,
      env: {
        AWS_S3_REGION: '',
        AWS_S3_ACCESS_KEY_ID: 'fake-key-id',
        AWS_S3_SECRET_ACCESS_KEY: 'fake-secret',
      },
    }, 'default-bucket', 'live/index.md');

    assert.strictEqual(resp.status, 502);
    assert.strictEqual(await resp.text(), '');
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      'x-error': 'error while fetching: 500',
    });
  });
});
