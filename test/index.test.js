/*
 * Copyright 2019 Adobe. All rights reserved.
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
import { encode } from 'querystring';
import { Request } from '@adobe/helix-fetch';
import { S3CachePlugin, MemCachePlugin } from '@adobe/helix-onedrive-support';
import { Nock, filterProperties } from './utils.js';
import testAuth from './fixtures/test-auth.js';
import { main } from '../src/index.js';

const FSTAB_1D = `
mountpoints:
  /: https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog
`;

const FSTAB_GD = `
mountpoints:
  /: https://drive.google.com/drive/u/2/folders/1vjng4ahZWph-9oeaMae16P9Kbb3xg4Cg
`;

const RESP_AUTH_DISCOVERY = {
  tenant_discovery_endpoint: 'https://login.windows.net/fa7b1b5a-7b34-4387-94ae-d2c178decee1/v2.0/.well-known/openid-configuration',
  'api-version': '1.1',
  metadata: [{
    preferred_network: 'login.microsoftonline.com',
    preferred_cache: 'login.windows.net',
    aliases: ['login.microsoftonline.com', 'login.windows.net', 'login.microsoft.com', 'sts.windows.net'],
  }],
};

const RESP_AUTH_WELL_KNOWN = {
  token_endpoint: 'https://login.microsoftonline.com/fa7b1b5a-7b34-4387-94ae-d2c178decee1/oauth2/v2.0/token',
  token_endpoint_auth_methods_supported: ['client_secret_post', 'private_key_jwt', 'client_secret_basic'],
  jwks_uri: 'https://login.microsoftonline.com/fa7b1b5a-7b34-4387-94ae-d2c178decee1/discovery/v2.0/keys',
  response_modes_supported: ['query', 'fragment', 'form_post'],
  subject_types_supported: ['pairwise'],
  id_token_signing_alg_values_supported: ['RS256'],
  response_types_supported: ['code', 'id_token', 'code id_token', 'id_token token'],
  scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
  issuer: 'https://login.microsoftonline.com/fa7b1b5a-7b34-4387-94ae-d2c178decee1/v2.0',
  request_uri_parameter_supported: false,
  userinfo_endpoint: 'https://graph.microsoft.com/oidc/userinfo',
  authorization_endpoint: 'https://login.microsoftonline.com/fa7b1b5a-7b34-4387-94ae-d2c178decee1/oauth2/v2.0/authorize',
  device_authorization_endpoint: 'https://login.microsoftonline.com/fa7b1b5a-7b34-4387-94ae-d2c178decee1/oauth2/v2.0/devicecode',
  http_logout_supported: true,
  frontchannel_logout_supported: true,
  end_session_endpoint: 'https://login.microsoftonline.com/fa7b1b5a-7b34-4387-94ae-d2c178decee1/oauth2/v2.0/logout',
  claims_supported: ['sub', 'iss', 'cloud_instance_name', 'cloud_instance_host_name', 'cloud_graph_host_name', 'msgraph_host', 'aud', 'exp', 'iat', 'auth_time', 'acr', 'nonce', 'preferred_username', 'name', 'tid', 'ver', 'at_hash', 'c_hash', 'email'],
  kerberos_endpoint: 'https://login.microsoftonline.com/fa7b1b5a-7b34-4387-94ae-d2c178decee1/kerberos',
  tenant_region_scope: 'WW',
  cloud_instance_name: 'microsoftonline.com',
  cloud_graph_host_name: 'graph.windows.net',
  msgraph_host: 'graph.microsoft.com',
  rbac_url: 'https://pas.windows.net',
};

const RESP_AUTH_DEFAULT = {
  token_type: 'Bearer',
  refresh_token: 'dummy-refresh-token',
  access_token: 'dummy-access-token',
  expires_in: 181000,
};

const DEFAULT_CONTEXT = (suffix = '', env = {}) => ({
  log: console,
  env: {
    ...env,
  },
  pathInfo: {
    suffix,
  },
});

const DEFAULT_REQUEST = (opts = {}) => new Request('https://localhost:3000/', {
  headers: {
    host: 'localhost:3000',
  },
  ...opts,
});

describe('Index Tests', () => {
  let nock;
  let savedProcessEnv;
  beforeEach(() => {
    nock = new Nock();
    savedProcessEnv = process.env;
    process.env = {
      ...process.env,
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'fake-key-id',
      AWS_SECRET_ACCESS_KEY: 'fake-secret',
    };
  });

  afterEach(() => {
    nock.done();
    process.env = savedProcessEnv;
  });

  it('renders index by default', async () => {
    const resp = await main(new Request('https://localhost/'), DEFAULT_CONTEXT('/register'));
    assert.strictEqual(resp.status, 200);
    const body = await resp.text();
    assert.match(body, /Enter github url/);
  });

  it('renders 404 outside /register', async () => {
    const resp = await main(new Request('https://localhost/'), DEFAULT_CONTEXT('/foo'));
    assert.strictEqual(resp.status, 404);
  });

  it('renders scripts.js', async () => {
    const resp = await main(new Request('https://localhost/'), DEFAULT_CONTEXT('/register/scripts.js'));
    assert.strictEqual(resp.status, 200);
    const body = await resp.text();
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'application/javascript',
    });
    assert.match(body, /addEventListener/);
  });

  it('renders styles.css', async () => {
    const resp = await main(new Request('https://localhost/'), DEFAULT_CONTEXT('/register/styles.css'));
    assert.strictEqual(resp.status, 200);
    const body = await resp.text();
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'text/css',
    });
    assert.match(body, /display: none/);
  });

  it('disconnect rejects GET', async () => {
    const resp = await main(new Request('https://localhost/'), DEFAULT_CONTEXT('/register/disconnect/owner/repo/content'));
    assert.strictEqual(resp.status, 405);
  });

  it('renders error for no fstab', async () => {
    nock.fstab('', 'owner', 'repo', 'main');
    nock('https://raw.githubusercontent.com')
      .get('/owner/repo/main/fstab.yaml')
      .reply(404);

    const resp = await main(DEFAULT_REQUEST(), DEFAULT_CONTEXT('/register/info/owner/repo/user', {
      AZURE_WORD2MD_CLIENT_ID: 'client-id',
      AZURE_WORD2MD_CLIENT_SECRET: 'client-secret',
    }));
    assert.strictEqual(resp.status, 200);
    const body = await resp.json();
    assert.deepStrictEqual(body.error, 'no fstab for owner/repo/main/fstab.yaml');
  });
});

describe('Index Tests (google)', () => {
  let nock;
  let savedProcessEnv;
  beforeEach(() => {
    nock = new Nock();
    savedProcessEnv = process.env;
    process.env = {
      ...process.env,
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'fake-key-id',
      AWS_SECRET_ACCESS_KEY: 'fake-secret',
      AWS_EXECUTION_ENV: 'aws-foo',
    };
  });

  afterEach(() => {
    nock.done();
    process.env = savedProcessEnv;
    new MemCachePlugin({}).clear();
  });

  it('google mountpoint renders links', async () => {
    nock.fstab(FSTAB_GD, 'owner', 'repo', 'main');
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/?list-type=2&prefix=853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f%2F.helix-auth%2F')
      .reply(200, `
        <?xml version="1.0" encoding="UTF-8"?>
        <ListBucketResult>
          <IsTruncated>false</IsTruncated>
          <Delimiter>/</Delimiter>
        </ListBucketResult>
      `);

    const resp = await main(DEFAULT_REQUEST(), DEFAULT_CONTEXT('/register/info/owner/repo', {}));
    assert.strictEqual(resp.status, 200);
    const body = await resp.json();
    assert.strictEqual(body.links.login, 'https://accounts.google.com/o/oauth2/v2/auth?scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.email%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.profile%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.readonly%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fspreadsheets%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdocuments&access_type=offline&prompt=consent&state=g%2Fowner%2Frepo&response_type=code&client_id=&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fregister%2Ftoken');
  });

  it('google default mountpoint renders links', async () => {
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/?list-type=2&prefix=default%2F.helix-auth%2F')
      .reply(200, `
        <?xml version="1.0" encoding="UTF-8"?>
        <ListBucketResult>
          <IsTruncated>false</IsTruncated>
          <Delimiter>/</Delimiter>
        </ListBucketResult>
      `);

    const resp = await main(DEFAULT_REQUEST(), DEFAULT_CONTEXT('/register/info/default/google', {}));
    assert.strictEqual(resp.status, 200);
    const body = await resp.json();
    assert.strictEqual(body.links.login, 'https://accounts.google.com/o/oauth2/v2/auth?scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.email%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.profile%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.readonly%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fspreadsheets%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdocuments&access_type=offline&prompt=consent&state=g%2Fdefault%2Fgoogle&response_type=code&client_id=&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fregister%2Ftoken');
  });

  it('google token endpoint can receive token', async () => {
    let cache;
    nock.fstab(FSTAB_GD, 'owner', 'repo', 'main');
    nock('https://oauth2.googleapis.com')
      .post('/token')
      .reply(200, RESP_AUTH_DEFAULT);
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/.helix-auth/auth-google-user.json?x-id=GetObject')
      .reply(404)
      .put('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/.helix-auth/auth-google-user.json?x-id=PutObject')
      .reply((uri, body) => {
        cache = Buffer.from(body, 'hex');
        return [201];
      });

    const resp = await main(DEFAULT_REQUEST({
      method: 'POST',
      body: encode({
        code: '123',
        client_info: '123',
        state: 'g/owner/repo/user',
      }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
    }), DEFAULT_CONTEXT('/register/token', {
      GOOGLE_HELIX_CLIENT_ID: 'client-id',
      GOOGLE_HELIX_CLIENT_SECRET: 'client-secret',
    }));

    assert.strictEqual(resp.status, 302);
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      location: '/register/connect/owner/repo/user',
    });

    const data = S3CachePlugin.decrypt('853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f', cache).toString('utf-8');
    const json = filterProperties(JSON.parse(data), ['expiry_date', 'extended_expires_on', 'cached_at']);
    assert.deepStrictEqual(json, {
      access_token: 'dummy-access-token',
      refresh_token: 'dummy-refresh-token',
      token_type: 'Bearer',
    });
  });

  it('google token endpoint can disconnect', async () => {
    nock.fstab(FSTAB_GD, 'owner', 'repo', 'main');
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/.helix-auth/auth-google-user.json?x-id=GetObject')
      .reply(404)
      .delete('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/.helix-auth/auth-google-user.json?x-id=DeleteObject')
      .reply(201);

    const resp = await main(DEFAULT_REQUEST({
      method: 'POST',
    }), DEFAULT_CONTEXT('/register/disconnect/owner/repo/user', {
      GOOGLE_HELIX_CLIENT_ID: 'client-id',
      GOOGLE_HELIX_CLIENT_SECRET: 'client-secret',
    }));

    assert.strictEqual(resp.status, 200);
  });

  it('google mountpoint renders connected', async () => {
    const authData = S3CachePlugin.encrypt(
      '853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f',
      Buffer.from(JSON.stringify({
        access_token: 'dummy',
        refresh_token: 'dummy',
        token_type: 'Bearer',
        expiry_date: Date.now() + 60 * 60 * 1000,
      }), 'utf-8'),
    );

    nock.fstab(FSTAB_GD, 'owner', 'repo', 'main');
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f/.helix-auth/auth-google-user.json?x-id=GetObject')
      .reply(200, authData, {
        'content-type': 'application/octet-stream',
      })
      .get('/?list-type=2&prefix=853bced1f82a05e9d27a8f63ecac59e70d9c14680dc5e417429f65e988f%2F.helix-auth%2F')
      .reply(200, `
        <?xml version="1.0" encoding="UTF-8"?>
        <ListBucketResult>
          <IsTruncated>false</IsTruncated>
          <Delimiter>/</Delimiter>
          <Contents>
            <Key>myproject/auth-default/auth-onedrive-content.json</Key>
          </Contents>
          <Contents>
            <Key>myproject/auth-default/auth-google-content.json</Key>
          </Contents>
          <Contents>
            <Key>myproject/auth-default/auth-google-index.json</Key>
          </Contents>
        </ListBucketResult>
      `);

    nock('https://www.googleapis.com')
      .get('/oauth2/v2/userinfo')
      .reply(200, {
        email: 'helix@adobe.com',
        id: '1234',
      });

    const resp = await main(DEFAULT_REQUEST(), DEFAULT_CONTEXT('/register/info/owner/repo/user', {
      GOOGLE_DOCS2MD_CLIENT_ID: 'client-id',
      GOOGLE_DOCS2MD_CLIENT_SECRET: 'client-secret',
    }));
    assert.strictEqual(resp.status, 200);
    const body = await resp.json();
    assert.deepStrictEqual(body.profile, {
      iss: '',
      scopes: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/documents',
      ],
      username: 'helix@adobe.com',
    });
    assert.deepStrictEqual(body.users, [{
      name: 'content',
      url: 'http://localhost:3000/register/connect/owner/repo/content',
    }, {
      name: 'index',
      url: 'http://localhost:3000/register/connect/owner/repo/index',
    }]);
  });
});

describe('Index Tests (sharepoint)', () => {
  let nock;
  let savedProcessEnv;
  beforeEach(() => {
    nock = new Nock();
    savedProcessEnv = process.env;
    process.env = {
      ...process.env,
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'fake-key-id',
      AWS_SECRET_ACCESS_KEY: 'fake-secret',
      AWS_EXECUTION_ENV: 'aws-foo',
    };
  });

  afterEach(() => {
    nock.done();
    process.env = savedProcessEnv;
    new MemCachePlugin({}).clear();
  });

  it('sharepoint github requires client id', async () => {
    nock.fstab(FSTAB_1D, 'owner', 'repo', 'main');
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/?list-type=2&prefix=9b08ed882cc3217ceb23a3e71d769dbe47576312869465a0a302ed29c6d%2F.helix-auth%2F')
      .reply(200, `
        <?xml version="1.0" encoding="UTF-8"?>
        <ListBucketResult>
          <IsTruncated>false</IsTruncated>
          <Delimiter>/</Delimiter>
        </ListBucketResult>
      `);
    const resp = await main(new Request('https://localhost/'), DEFAULT_CONTEXT('/register/info/owner/repo'));
    assert.strictEqual(resp.status, 200);
    const body = await resp.json();
    assert.strictEqual(body.error, 'Missing clientId.');
  });

  it('sharepoint mountpoint renders link', async () => {
    nock.fstab(FSTAB_1D, 'owner', 'repo', 'main');
    nock('https://login.windows.net')
      .get('/adobe.onmicrosoft.com/.well-known/openid-configuration')
      .reply(200, {
        issuer: 'https://sts.windows.net/fa7b1b5a-7b34-4387-94ae-d2c178decee1/',
      });
    nock('https://login.microsoftonline.com')
      .get('/common/discovery/instance?api-version=1.1&authorization_endpoint=https://login.windows.net/fa7b1b5a-7b34-4387-94ae-d2c178decee1/oauth2/v2.0/authorize')
      .reply(200, RESP_AUTH_DISCOVERY)
      .get('/fa7b1b5a-7b34-4387-94ae-d2c178decee1/v2.0/.well-known/openid-configuration')
      .reply(200, RESP_AUTH_WELL_KNOWN);
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/?list-type=2&prefix=9b08ed882cc3217ceb23a3e71d769dbe47576312869465a0a302ed29c6d%2F.helix-auth%2F')
      .reply(200, `
        <?xml version="1.0" encoding="UTF-8"?>
        <ListBucketResult>
          <IsTruncated>false</IsTruncated>
          <Delimiter>/</Delimiter>
        </ListBucketResult>
      `);

    const resp = await main(DEFAULT_REQUEST(), DEFAULT_CONTEXT('/register/info/owner/repo', {
      AZURE_WORD2MD_CLIENT_ID: 'client-id',
      AZURE_WORD2MD_CLIENT_SECRET: 'client-secret',
    }));
    assert.strictEqual(resp.status, 200);
    const body = await resp.json();
    // console.log(body);
    assert.strictEqual(body.mp.url, 'https://adobe.sharepoint.com/sites/TheBlog/Shared%20Documents/theblog');
    assert.match(body.links.login, /https:\/\/login\.microsoftonline\.com\/fa7b1b5a-7b34-4387-94ae-d2c178decee1\/oauth2\/v2\.0\/authorize\?client_id=client-id&scope=user\.read%20openid%20profile%20offline_access&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fregister%2Ftoken&client-request-id=[0-9a-f-]+&response_mode=form_post&response_type=code&x-client-SKU=msal\.js\.node&x-client-VER=[^&]+&x-client-OS=[^&]+&x-client-CPU=[^&]+&client_info=1&prompt=consent&state=a%2Fowner%2Frepo/);
  });

  it('sharepoint default mountpoint renders link', async () => {
    nock('https://login.windows.net')
      .get('/adobe.onmicrosoft.com/.well-known/openid-configuration')
      .reply(200, {
        issuer: 'https://sts.windows.net/fa7b1b5a-7b34-4387-94ae-d2c178decee1/',
      });
    nock('https://login.microsoftonline.com')
      .get('/common/discovery/instance?api-version=1.1&authorization_endpoint=https://login.windows.net/fa7b1b5a-7b34-4387-94ae-d2c178decee1/oauth2/v2.0/authorize')
      .reply(200, RESP_AUTH_DISCOVERY)
      .get('/fa7b1b5a-7b34-4387-94ae-d2c178decee1/v2.0/.well-known/openid-configuration')
      .reply(200, RESP_AUTH_WELL_KNOWN);
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/?list-type=2&prefix=default%2F.helix-auth%2F')
      .reply(200, `
        <?xml version="1.0" encoding="UTF-8"?>
        <ListBucketResult>
          <IsTruncated>false</IsTruncated>
          <Delimiter>/</Delimiter>
        </ListBucketResult>
      `);

    const resp = await main(DEFAULT_REQUEST(), DEFAULT_CONTEXT('/register/info/default/onedrive', {
      AZURE_WORD2MD_CLIENT_ID: 'client-id',
      AZURE_WORD2MD_CLIENT_SECRET: 'client-secret',
    }));
    assert.strictEqual(resp.status, 200);
    const body = await resp.json();
    // console.log(body);
    assert.strictEqual(body.mp.url, 'https://adobe.sharepoint.com/');
    assert.match(body.links.login, /https:\/\/login\.microsoftonline\.com\/fa7b1b5a-7b34-4387-94ae-d2c178decee1\/oauth2\/v2\.0\/authorize\?client_id=client-id&scope=user\.read%20openid%20profile%20offline_access&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fregister%2Ftoken&client-request-id=[0-9a-f-]+&response_mode=form_post&response_type=code&x-client-SKU=msal\.js\.node&x-client-VER=[^&]+&x-client-OS=[^&]+&x-client-CPU=[^&]+&client_info=1&prompt=consent&state=a%2Fdefault%2Fonedrive/);
  });

  it('sharepoint token endpoint can receive token', async () => {
    let cache;
    nock.fstab(FSTAB_1D, 'owner', 'repo', 'main');
    nock('https://login.windows.net')
      .get('/adobe.onmicrosoft.com/.well-known/openid-configuration')
      .reply(200, {
        issuer: 'https://sts.windows.net/fa7b1b5a-7b34-4387-94ae-d2c178decee1/',
      });
    nock('https://login.microsoftonline.com')
      .get('/common/discovery/instance?api-version=1.1&authorization_endpoint=https://login.windows.net/fa7b1b5a-7b34-4387-94ae-d2c178decee1/oauth2/v2.0/authorize')
      .reply(200, RESP_AUTH_DISCOVERY)
      .get('/fa7b1b5a-7b34-4387-94ae-d2c178decee1/v2.0/.well-known/openid-configuration')
      .reply(200, RESP_AUTH_WELL_KNOWN)
      .post('/fa7b1b5a-7b34-4387-94ae-d2c178decee1/oauth2/v2.0/token')
      .reply(200, RESP_AUTH_DEFAULT);
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/9b08ed882cc3217ceb23a3e71d769dbe47576312869465a0a302ed29c6d/.helix-auth/auth-onedrive-user.json?x-id=GetObject')
      .reply(404)
      .put('/9b08ed882cc3217ceb23a3e71d769dbe47576312869465a0a302ed29c6d/.helix-auth/auth-onedrive-user.json?x-id=PutObject')
      .reply((uri, body) => {
        cache = Buffer.from(body, 'hex');
        return [201];
      });

    const resp = await main(DEFAULT_REQUEST({
      method: 'POST',
      body: encode({
        code: '123',
        client_info: '123',
        state: 'a/owner/repo/user',
      }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
    }), DEFAULT_CONTEXT('/register/token', {
      AZURE_WORD2MD_CLIENT_ID: 'client-id',
      AZURE_WORD2MD_CLIENT_SECRET: 'client-secret',
    }));

    assert.strictEqual(resp.status, 302);
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      location: '/register/connect/owner/repo/user',
    });

    const data = S3CachePlugin.decrypt('9b08ed882cc3217ceb23a3e71d769dbe47576312869465a0a302ed29c6d', cache).toString('utf-8');
    const json = filterProperties(JSON.parse(data), ['expires_on', 'extended_expires_on', 'cached_at']);
    assert.deepStrictEqual(json, {
      AccessToken: {
        '-login.windows.net-accesstoken-client-id-fa7b1b5a-7b34-4387-94ae-d2c178decee1-user.read openid profile offline_access--': {
          client_id: 'client-id',
          credential_type: 'AccessToken',
          environment: 'login.windows.net',
          home_account_id: '',
          realm: 'fa7b1b5a-7b34-4387-94ae-d2c178decee1',
          secret: 'dummy-access-token',
          target: 'user.read openid profile offline_access',
          token_type: 'Bearer',
        },
      },
      Account: {},
      AppMetadata: {},
      IdToken: {},
      RefreshToken: {
        '-login.windows.net-refreshtoken-client-id----': {
          client_id: 'client-id',
          credential_type: 'RefreshToken',
          environment: 'login.windows.net',
          home_account_id: '',
          secret: 'dummy-refresh-token',
        },
      },
    });
    new MemCachePlugin({}).clear();
    nock.done();
    nock = new Nock();
  });

  it('sharepoint token endpoint can disconnect', async () => {
    nock.fstab(FSTAB_1D, 'owner', 'repo', 'main');
    nock('https://login.windows.net')
      .get('/adobe.onmicrosoft.com/.well-known/openid-configuration')
      .reply(200, {
        issuer: 'https://sts.windows.net/fa7b1b5a-7b34-4387-94ae-d2c178decee1/',
      });
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .delete('/9b08ed882cc3217ceb23a3e71d769dbe47576312869465a0a302ed29c6d/.helix-auth/auth-onedrive-user.json?x-id=DeleteObject')
      .reply(201);

    const resp = await main(DEFAULT_REQUEST({
      method: 'POST',
    }), DEFAULT_CONTEXT('/register/disconnect/owner/repo/user', {
      AZURE_WORD2MD_CLIENT_ID: 'client-id',
      AZURE_WORD2MD_CLIENT_SECRET: 'client-secret',
    }));

    assert.strictEqual(resp.status, 200);
  });

  it('sharepoint mountpoint renders connected', async () => {
    const authData = S3CachePlugin.encrypt(
      '9b08ed882cc3217ceb23a3e71d769dbe47576312869465a0a302ed29c6d',
      Buffer.from(JSON.stringify(testAuth()), 'utf-8'),
    );

    nock.fstab(FSTAB_1D, 'owner', 'repo', 'main');
    nock('https://login.windows.net')
      .get('/adobe.onmicrosoft.com/.well-known/openid-configuration')
      .reply(200, {
        issuer: 'https://sts.windows.net/fa7b1b5a-7b34-4387-94ae-d2c178decee1/',
      });
    nock('https://login.microsoftonline.com')
      .get('/common/discovery/instance?api-version=1.1&authorization_endpoint=https://login.windows.net/fa7b1b5a-7b34-4387-94ae-d2c178decee1/oauth2/v2.0/authorize')
      .times(3)
      .optionally()
      .reply(200, RESP_AUTH_DISCOVERY)
      .get('/fa7b1b5a-7b34-4387-94ae-d2c178decee1/v2.0/.well-known/openid-configuration')
      .times(3)
      .optionally()
      .reply(200, RESP_AUTH_WELL_KNOWN);
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/?list-type=2&prefix=9b08ed882cc3217ceb23a3e71d769dbe47576312869465a0a302ed29c6d%2F.helix-auth%2F')
      .reply(200, `
        <?xml version="1.0" encoding="UTF-8"?>
        <ListBucketResult>
          <IsTruncated>false</IsTruncated>
          <Delimiter>/</Delimiter>
        </ListBucketResult>
      `);
    nock('https://helix-content-bus.s3.us-east-1.amazonaws.com')
      .get('/9b08ed882cc3217ceb23a3e71d769dbe47576312869465a0a302ed29c6d/.helix-auth/auth-onedrive-user.json?x-id=GetObject')
      .reply(200, authData, {
        'content-type': 'application/octet-stream',
      });

    const resp = await main(DEFAULT_REQUEST(), DEFAULT_CONTEXT('/register/info/owner/repo/user', {
      AZURE_WORD2MD_CLIENT_ID: '83ab2922-5f11-4e4d-96f3-d1e0ff152856',
      AZURE_WORD2MD_CLIENT_SECRET: 'client-secret',
    }));
    assert.strictEqual(resp.status, 200);
    const body = await resp.json();
    assert.deepStrictEqual(body.profile, {
      name: 'Project Helix Integration',
      scopes: [
        'Files.ReadWrite.All',
        'MyFiles.Read',
        'openid',
        'profile',
        'Sites.ReadWrite.All',
        'User.Read',
        'email',
      ],
      username: 'helix@adobe.com',
    });
  });
});
