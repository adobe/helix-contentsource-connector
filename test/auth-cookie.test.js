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

/* eslint-env mocha */
import assert from 'assert';
import { clearAuthCookie, getAuthCookie, setAuthCookie } from '../src/auth-cookie.js';

describe('Auth Cookie Test', () => {
  it('clears the auth cookie', () => {
    assert.strictEqual(clearAuthCookie({}), 'auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=None');
    assert.strictEqual(clearAuthCookie({ functionPath: '/root' }), 'auth_token=; Path=/root; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=None');
  });

  it('sets the auth cookie', () => {
    assert.strictEqual(
      setAuthCookie({}, 'id', 'access', 'name'),
      'auth_token=id_token%3Did%26access_token%3Daccess%26idp_name%3Dname; Path=/; HttpOnly; Secure; SameSite=None',
    );
    assert.strictEqual(
      setAuthCookie({ functionPath: '/root' }, 'id', 'access', 'name'),
      'auth_token=id_token%3Did%26access_token%3Daccess%26idp_name%3Dname; Path=/root; HttpOnly; Secure; SameSite=None',
    );
  });

  it('gets the auth cookie', () => {
    const info = {
      headers: {
        cookie: 'auth_token=id_token=123&idp_name=foo&access_token=bar',
      },
    };
    const req = {
      headers: new Map(Object.entries({
        cookie: 'auth_token=id_token=123&idp_name=foo&access_token=bar',
      })),
    };
    assert.deepStrictEqual(JSON.parse(JSON.stringify(getAuthCookie(info, req))), {
      id_token: '123',
      idp_name: 'foo',
      access_token: 'bar',
    });

    const { cookies } = info;
    getAuthCookie(info);
    assert.strictEqual(cookies, info.cookies, 'info.cookies should not be parsed twice');
  });
});
