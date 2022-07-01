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
export default {
  name: 'google',
  scope: [
    'openid',
    'profile',
    'email',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/documents',
  ].join(' '),
  mountType: 'google',
  client: (ctx) => ({
    clientId: ctx.env.GOOGLE_DOCS2MD_CLIENT_ID,
    clientSecret: ctx.env.GOOGLE_DOCS2MD_CLIENT_SECRET,
  }),
  discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
  loginPrompt: 'select_account',
  // todo: fetch from discovery document
  discovery: () => ({
    issuer: 'https://accounts.google.com',
    authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    device_authorization_endpoint: 'https://oauth2.googleapis.com/device/code',
    token_endpoint: 'https://oauth2.googleapis.com/token',
    userinfo_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
    revocation_endpoint: 'https://oauth2.googleapis.com/revoke',
    jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
  }),
  routes: {
    login: '/auth/google',
    loginRedirect: '/auth/google/ack',
  },
};
