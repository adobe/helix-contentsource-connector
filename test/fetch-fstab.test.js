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
import assert from 'assert';
import { Nock } from './utils.js';
import fetchFstab from '../src/fetch-fstab.js';

const DEFAULT_CONTEXT = () => ({
  log: console,
  env: {
    AWS_S3_REGION: 'us-east-1',
    AWS_S3_ACCESS_KEY_ID: 'fake-key-id',
    AWS_S3_SECRET_ACCESS_KEY: 'fake-secret',
  },
});

const FSTAB = `
mountpoints:
  /ms: https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog
  /gdocs: https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-9oeaMae16P9Kbb3xg4Cg
  /google-home.md: gdrive:1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE
`;

describe('fetch-fstab tests', () => {
  let nock;
  beforeEach(() => {
    nock = new Nock();
  });

  afterEach(() => {
    nock.done();
  });

  it('downloads fstab from code-bus', async () => {
    nock.fstab(FSTAB, 'owner', 'repo', 'main');
    const mount = await fetchFstab(DEFAULT_CONTEXT(), {
      owner: 'owner',
      repo: 'repo',
      ref: 'main',
    });
    assert.strictEqual(mount.sourceType, 'code-bus');
    assert.deepStrictEqual(mount.toJSON(), {
      mountpoints: {
        '/gdocs': 'https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-9oeaMae16P9Kbb3xg4Cg',
        '/google-home.md': 'gdrive:1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE',
        '/ms': 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog',
      },
    });
  });

  it('download fstab once', async () => {
    nock.fstab(FSTAB, 'owner', 'repo', 'main');
    const ctx = DEFAULT_CONTEXT();
    const mount1 = await fetchFstab(ctx, {
      owner: 'owner',
      repo: 'repo',
      ref: 'main',
    });
    const mount2 = await fetchFstab(ctx, {
      owner: 'owner',
      repo: 'repo',
      ref: 'main',
    });
    assert.strictEqual(mount1, mount2);
  });

  it('downloads fstab from github when code-bus fails', async () => {
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .get('/owner/repo/main/fstab.yaml?x-id=GetObject')
      .reply(404);
    nock('https://raw.githubusercontent.com')
      .get('/owner/repo/main/fstab.yaml')
      .reply(200, FSTAB);

    const mount = await fetchFstab(DEFAULT_CONTEXT(), {
      owner: 'owner',
      repo: 'repo',
      ref: 'main',
    });
    assert.strictEqual(mount.sourceType, 'github');
    assert.deepStrictEqual(mount.toJSON(), {
      mountpoints: {
        '/gdocs': 'https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-9oeaMae16P9Kbb3xg4Cg',
        '/google-home.md': 'gdrive:1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE',
        '/ms': 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog',
      },
    });
  });

  it('downloads fstab from github when code-bus fails (uppercase branch)', async () => {
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .get('/owner/repo/main/fstab.yaml?x-id=GetObject')
      .reply(404);
    nock('https://raw.githubusercontent.com')
      .get('/owner/repo/MAIN/fstab.yaml')
      .reply(200, FSTAB);

    const mount = await fetchFstab(DEFAULT_CONTEXT(), {
      owner: 'owner',
      repo: 'repo',
      ref: 'main',
      branch: 'MAIN',
    });
    assert.strictEqual(mount.sourceType, 'github');
    assert.deepStrictEqual(mount.toJSON(), {
      mountpoints: {
        '/gdocs': 'https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-9oeaMae16P9Kbb3xg4Cg',
        '/google-home.md': 'gdrive:1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE',
        '/ms': 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog',
      },
    });
  });

  it('downloads fstab from github when code-bus fails (authenticated)', async () => {
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .get('/owner/repo/main/fstab.yaml?x-id=GetObject')
      .reply(404);
    nock('https://raw.githubusercontent.com')
      .get('/owner/repo/main/fstab.yaml')
      .matchHeader('authorization', 'token foobar')
      .reply(200, FSTAB);

    const mount = await fetchFstab({
      ...DEFAULT_CONTEXT(),
      githubToken: 'foobar',
    }, {
      owner: 'owner',
      repo: 'repo',
      ref: 'main',
    });
    assert.deepStrictEqual(mount.toJSON(), {
      mountpoints: {
        '/gdocs': 'https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-9oeaMae16P9Kbb3xg4Cg',
        '/google-home.md': 'gdrive:1GIItS1y0YXTySslLGqJZUFxwFH1DPlSg3R7ybYY3ATE',
        '/ms': 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog',
      },
    });
  });

  it('throws error for no fstab', async () => {
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .get('/owner/repo/main/fstab.yaml?x-id=GetObject')
      .reply(404);
    nock('https://raw.githubusercontent.com')
      .get('/owner/repo/main/fstab.yaml')
      .reply(404);

    const mount = fetchFstab(DEFAULT_CONTEXT(), {
      owner: 'owner',
      repo: 'repo',
      ref: 'main',
    });
    await assert.rejects(mount, Error('no fstab for owner/repo/main/fstab.yaml'));
  });

  it('returns null for optional fstab', async () => {
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .get('/owner/repo/main/fstab.yaml?x-id=GetObject')
      .reply(404);
    nock('https://raw.githubusercontent.com')
      .get('/owner/repo/main/fstab.yaml')
      .reply(404);

    const mount = await fetchFstab(DEFAULT_CONTEXT(), {
      owner: 'owner',
      repo: 'repo',
      ref: 'main',
    }, true);
    await assert.strictEqual(mount, null);
  });

  it('throws error for error on content-bus', async () => {
    nock('https://helix-code-bus.s3.us-east-1.amazonaws.com')
      .get('/owner/repo/main/fstab.yaml?x-id=GetObject')
      .times(3)
      .reply(500);
    nock('https://raw.githubusercontent.com');

    const mount = fetchFstab(DEFAULT_CONTEXT(), {
      owner: 'owner',
      repo: 'repo',
      ref: 'main',
    });
    await assert.rejects(mount, Error('Unable to fetch fstab'));
  });
});
