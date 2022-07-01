/*
 * Copyright 2022 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { exportJWK, generateKeyPair } from 'jose';

const idp = {
  name: 'test',
  scope: 'openid profile email',
  mountType: 'google',
  client: () => ({
    clientId: process.env.TEST_CLIENT_ID ?? 'dummy-clientid',
    clientSecret: 'dummy-secret',
  }),
  discoveryUrl: 'https://example.com/.well-known/openid-configuration',
  loginPrompt: 'select_account',
  // todo: fetch from discovery document
  discovery: async () => {
    if (!idp.privateKey) {
      const keyPair = await generateKeyPair('RS256');
      idp.privateKey = keyPair.privateKey;
      idp.publicJwk = await exportJWK(keyPair.publicKey);
    }

    return {
      issuer: 'urn:example:issuer',
      authorization_endpoint: 'https://accounts.example.com/o/oauth2/v2/auth',
      device_authorization_endpoint: 'https://oauth2.example.com/device/code',
      token_endpoint: 'https://www.example.com/token',
      userinfo_endpoint: 'https://openidconnect.example.com/v1/userinfo',
      revocation_endpoint: 'https://oauth2.example.com/revoke',
      jwks_uri: 'https://www.example.com/oauth2/v3/certs',
      jwks: {
        keys: [
          idp.publicJwk,
        ],
      },
    };
  },
  routes: {
    login: '/auth/test',
    loginRedirect: '/auth/test/ack',
  },
};

export default idp;
