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
import assert from 'assert';
import nock from 'nock';

export function Nock() {
  const DEFAULT_AUTH = {
    token_type: 'Bearer',
    refresh_token: 'dummy',
    access_token: 'dummy',
    expires_in: 181000,
  };

  const scopes = {};

  let unmatched;

  function noMatchHandler(req) {
    unmatched.push(req);
  }

  function nocker(url) {
    let scope = scopes[url];
    if (!scope) {
      scope = nock(url);
      scopes[url] = scope;
    }
    if (!unmatched) {
      unmatched = [];
      nock.emitter.on('no match', noMatchHandler);
    }
    return scope;
  }

  nocker.done = () => {
    if (unmatched) {
      nock.emitter.off('no match', noMatchHandler);
      assert.deepStrictEqual(unmatched.map((req) => {
        // eslint-disable-next-line no-param-reassign
        req = req.options || req;
        return `${req.method} https://${req.hostname}${req.path}`;
      }), []);
    }
    Object.values(scopes).forEach((s) => s.done());
  };

  nocker.fstab = (fstab, owner = 'owner', repo = 'repo', ref = 'ref') => nocker('https://helix-code-bus.s3.us-east-1.amazonaws.com')
    .get(`/${owner}/${repo}/${ref}/fstab.yaml?x-id=GetObject`)
    .reply(fstab ? 200 : 404, fstab);

  nocker.loginWindowsNet = (auth = DEFAULT_AUTH) => nocker('https://login.windows.net')
    .post('/common/oauth2/token?api-version=1.0')
    .reply(200, auth);

  return nocker;
}

export function filterProperties(obj, names) {
  return Object.entries(obj).reduce((prev, [key, value]) => {
    if (names.indexOf(key) >= 0) {
      // ignore
    } else if (typeof value === 'object') {
      // eslint-disable-next-line no-param-reassign
      prev[key] = filterProperties(value, names);
    } else {
      // eslint-disable-next-line no-param-reassign
      prev[key] = value;
    }
    return prev;
  }, {});
}
