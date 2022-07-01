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
import { decode, encode } from 'querystring';
import { parse, serialize } from 'cookie';

export function clearAuthCookie(info) {
  return serialize('auth_token', '', {
    path: info.functionPath || '/',
    httpOnly: true,
    secure: true,
    expires: new Date(0),
    sameSite: 'none',
  });
}

export function encodeAuthToken(idToken, accessToken, idpName) {
  return encode({
    id_token: idToken,
    access_token: accessToken,
    idp_name: idpName,
  });
}

export function setAuthCookie(info, idToken, accessToken, idpName) {
  // we have problems setting multiple cookies with the current response handling,
  // so we encode it again
  const value = encodeAuthToken(idToken, accessToken, idpName);
  return serialize('auth_token', value, {
    path: info.functionPath || '/',
    httpOnly: true,
    secure: true,
    sameSite: 'none',
  });
}

export function getAuthCookie(info, request) {
  // add cookies if not already present
  if (!info.cookies) {
    const hdr = request.headers.get('cookie');
    // eslint-disable-next-line no-param-reassign
    info.cookies = hdr ? parse(hdr) : {};
  }
  const { auth_token: authToken } = info.cookies;
  if (!authToken) {
    return { };
  }
  return decode(authToken);
}
