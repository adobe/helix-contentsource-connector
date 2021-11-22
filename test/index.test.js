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
import { Request } from '@adobe/helix-universal';
import { Nock } from './utils.js';

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
  refresh_token: 'dummy',
  access_token: 'dummy',
  expires_in: 181000,
};

const DEFAULT_CONTEXT = (suffix = '/', env = {}) => ({
  log: console,
  env: {
    AWS_S3_REGION: 'us-east-1',
    AWS_S3_ACCESS_KEY_ID: 'fake-key-id',
    AWS_S3_SECRET_ACCESS_KEY: 'fake-secret',
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
  beforeEach(() => {
    nock = new Nock();
  });

  afterEach(() => {
    nock.done();
  });

  it('renders index by default', async () => {
    const resp = await main(new Request('https://localhost/'), DEFAULT_CONTEXT());
    assert.strictEqual(resp.status, 200);
    const body = await resp.text();
    assert.match(body, /Enter github url/);
  });

  it('renders error for no fstab', async () => {
    nock.fstab('', 'owner', 'repo', 'main');
    nock('https://raw.githubusercontent.com')
      .get('/owner/repo/main/fstab.yaml')
      .reply(404);

    const resp = await main(DEFAULT_REQUEST(), DEFAULT_CONTEXT('/connect/owner/repo', {
      AZURE_WORD2MD_CLIENT_ID: 'client-id',
      AZURE_WORD2MD_CLIENT_SECRET: 'client-secret',
    }));
    assert.strictEqual(resp.status, 200);
    const body = await resp.text();
    assert.match(body, /Enter github url/);
    assert.match(body, /<p class="error">no fstab for owner\/repo\/main\/fstab\.yaml<\/p>/);
  });
});

describe('Index Tests (google)', () => {
  let nock;
  beforeEach(() => {
    nock = new Nock();
  });

  afterEach(() => {
    nock.done();
  });

  it('google mountpoint renders link', async () => {
    nock.fstab(FSTAB_GD, 'owner', 'repo', 'main');

    const resp = await main(DEFAULT_REQUEST(), DEFAULT_CONTEXT('/connect/owner/repo', {}));
    assert.strictEqual(resp.status, 200);
    const body = await resp.text();
    // console.log(body);
    assert.match(body, /<a href="http:\/\/localhost:3000\/">start over<\/a>/);
    assert.match(body, /content: <a href="https:\/\/drive.google.com\/drive\/u\/2\/folders\/1vjng4ahZWph-9oeaMae16P9Kbb3xg4Cg">https:\/\/drive.google.com\/drive\/u\/2\/folders\/1vjng4ahZWph-9oeaMae16P9Kbb3xg4Cg<\/a>/);
    assert.match(body, /<a href="about:blank">Connect to Google \(unsupported\)<\/a>/);
  });
});

describe('Index Tests (sharepoint)', () => {
  let nock;
  beforeEach(() => {
    nock = new Nock();
  });

  afterEach(() => {
    nock.done();
  });

  it('sharepoint github requires client id', async () => {
    nock.fstab(FSTAB_1D, 'owner', 'repo', 'main');
    const resp = await main(new Request('https://localhost/'), DEFAULT_CONTEXT('/connect/owner/repo'));
    assert.strictEqual(resp.status, 200);
    const body = await resp.text();
    // console.log(body);
    assert.match(body, /Enter github url/);
    assert.match(body, /<p class="error">Missing clientId\.<\/p>/);
  });

  it('sharepoint mountpoint renders link', async () => {
    nock.fstab(FSTAB_1D, 'owner', 'repo', 'main');
    nock('https://login.microsoftonline.com')
      .get('/common/discovery/instance?api-version=1.1&authorization_endpoint=https://login.windows.net/fa7b1b5a-7b34-4387-94ae-d2c178decee1/oauth2/v2.0/authorize')
      .reply(200, RESP_AUTH_DISCOVERY)
      .get('/fa7b1b5a-7b34-4387-94ae-d2c178decee1/v2.0/.well-known/openid-configuration')
      .reply(200, RESP_AUTH_WELL_KNOWN);

    const resp = await main(DEFAULT_REQUEST(), DEFAULT_CONTEXT('/connect/owner/repo', {
      AZURE_WORD2MD_CLIENT_ID: 'client-id',
      AZURE_WORD2MD_CLIENT_SECRET: 'client-secret',
    }));
    assert.strictEqual(resp.status, 200);
    const body = await resp.text();
    // console.log(body);
    assert.match(body, /<a href="http:\/\/localhost:3000\/">start over<\/a>/);
    assert.match(body, /content: <a href="https:\/\/adobe\.sharepoint\.com\/sites\/TheBlog\/Shared%20Documents\/theblog">https:\/\/adobe\.sharepoint\.com\/sites\/TheBlog\/Shared%20Documents\/theblog<\/a>/);
    assert.match(body, /<a href="https:\/\/login\.microsoftonline\.com\/fa7b1b5a-7b34-4387-94ae-d2c178decee1\/oauth2\/v2\.0\/authorize\?client_id=client-id&amp;scope=user\.read%20openid%20profile%20offline_access&amp;redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Ftoken&amp;client-request-id=[0-9a-f-]+&amp;response_mode=form_post&amp;response_type=code&amp;x-client-SKU=msal\.js\.node&amp;x-client-VER=1\.3\.3&amp;x-client-OS=[^&]+&amp;x-client-CPU=[^&]+&amp;client_info=1&amp;prompt=consent&amp;state=owner%2Frepo">Connect to Sharepoint \/ Onedrive<\/a>/);
  });

  it('sharepoint token endpoint can receive token', async () => {
    nock.fstab(FSTAB_GD, 'owner', 'repo', 'main');
    nock('https://login.microsoftonline.com')
      .get('/common/discovery/instance?api-version=1.1&authorization_endpoint=https://login.windows.net/fa7b1b5a-7b34-4387-94ae-d2c178decee1/oauth2/v2.0/authorize')
      .reply(200, RESP_AUTH_DISCOVERY)
      .get('/fa7b1b5a-7b34-4387-94ae-d2c178decee1/v2.0/.well-known/openid-configuration')
      .reply(200, RESP_AUTH_WELL_KNOWN)
      .post('/fa7b1b5a-7b34-4387-94ae-d2c178decee1/oauth2/v2.0/token')
      .reply(200, RESP_AUTH_DEFAULT);

    const resp = await main(DEFAULT_REQUEST({
      method: 'POST',
      body: encode({
        code: '123',
        client_info: '123',
        state: 'owner/repo',
      }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
    }), DEFAULT_CONTEXT('/token', {
      AZURE_WORD2MD_CLIENT_ID: 'client-id',
      AZURE_WORD2MD_CLIENT_SECRET: 'client-secret',
    }));

    assert.strictEqual(resp.status, 302);
    assert.deepStrictEqual(resp.headers.plain(), {
      'content-type': 'text/plain; charset=utf-8',
      location: '/connect/owner/repo',
    });
  });
});
