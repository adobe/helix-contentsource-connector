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
import { encode } from 'querystring';
import {
  createLocalJWKSet, createRemoteJWKSet, errors, jwtVerify, UnsecuredJWT,
} from 'jose';
import crypto from 'crypto';
import { context, h1, Response } from '@adobe/helix-fetch';
import { clearAuthCookie, getAuthCookie, setAuthCookie } from './auth-cookie.js';
import idpGoogle from './idp-configs/google.js';
import idpMicrosoft from './idp-configs/microsoft.js';

export const IDPS = {
  google: idpGoogle,
  onedrive: idpMicrosoft,
  microsoft: idpMicrosoft,
};

export const { fetch } = process.env.HELIX_FETCH_FORCE_HTTP1
  /* c8 ignore next */ ? h1()
  /* c8 ignore next */ : context();
/**
 * Decodes the given id_token for the given idp. if `lenient` is `true`, the clock tolerance
 * is set to 1 week. this allows to extract some profile information that can be used as login_hint.
 * @param {AdminContext} ctx the universal context
 * @param {PathInfo} info the path info
 * @param {IDPConfig} idp
 * @param {string} idToken
 * @param {boolean} lenient
 * @returns {Promise<JWTPayload>}
 */
export async function decodeIdToken(ctx, info, idp, idToken, lenient = false) {
  const { log } = ctx;
  const discovery = await idp.discovery(info.tenantId);

  const jwks = discovery.jwks
    ? createLocalJWKSet(discovery.jwks)
    : createRemoteJWKSet(new URL(discovery.jwks_uri));

  const { payload } = await jwtVerify(idToken, jwks, {
    audience: idp.client(ctx).clientId,
    clockTolerance: lenient ? 7 * 24 * 60 * 60 : 0,
  });

  const validate = idp.validateIssuer ?? ((iss) => (iss) === discovery.issuer);
  if (!validate(payload.iss)) {
    throw new errors.JWTClaimValidationFailed('unexpected "iss" claim value', 'iss', 'check_failed');
  }
  // delete from information not needed in the profile
  ['azp', 'sub', 'at_hash', 'nonce', 'aio', 'c_hash'].forEach((prop) => delete payload[prop]);

  // compute ttl
  payload.ttl = payload.exp - Math.floor(Date.now() / 1000);

  // compute an userid hash (only if email is present)
  if (payload.email) {
    payload.hlx_hash = crypto.createHash('sha1')
      .update(payload.iss)
      .update(payload.email)
      .digest('base64url');
  }

  log.info(`decoded id_token${lenient ? ' (lenient)' : ''} from ${payload.iss} and validated payload.`);
  return payload;
}

/**
 * Returns a redirect (302) response to the IDPs login endpoint
 *
 * @param {UniversalContext} ctx the universal context
 * @param {PathInfo} info path info
 * @param {IDPConfig} idp IDP config
 * @return {Promise<Response>} response
 */
export async function redirectToLogin(ctx, info, idp) {
  const { log } = ctx;
  const discovery = await idp.discovery(info.tenantId);
  const url = new URL(discovery.authorization_endpoint);
  const state = new UnsecuredJWT({
    type: 'login',
    idp: idp.name,
    owner: info.owner,
    repo: info.repo,
    tid: info.tenantId,
  }).encode();
  url.searchParams.append('client_id', idp.client(ctx).clientId);
  url.searchParams.append('response_type', 'code');
  url.searchParams.append('scope', idp.scope);
  url.searchParams.append('nonce', crypto.randomUUID());
  url.searchParams.append('state', state);
  url.searchParams.append('redirect_uri', info.links.token);
  url.searchParams.append('prompt', 'consent');

  log.info('redirecting to login page', url.href);
  return new Response('', {
    status: 302,
    headers: {
      'cache-control': 'no-store, private, must-revalidate',
      location: url.href,
      'set-cookie': clearAuthCookie(info),
    },
  });
}

/**
 * Performs a token exchange from the code flow and redirects to the root page
 *
 * @param {UniversalContext} ctx the universal context
 * @param {PathInfo} info path info
 * @return {Promise<Response>} response
 */
export async function exchangeToken(ctx, info, idp) {
  const { log, data } = ctx;
  const discovery = await idp.discovery(info.tenantId);
  const url = new URL(discovery.token_endpoint);
  const client = idp.client(ctx);
  const body = {
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code: data.code,
    grant_type: 'authorization_code',
    redirect_uri: info.links.token,
  };
  const res = await fetch(url.href, {
    method: 'POST',
    body: encode(body),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
  });
  if (!res.ok) {
    log.warn(`code exchange failed: ${res.status}`, await res.text());
    return new Response('', {
      status: 401,
    });
  }

  const tokenResponse = await res.json();
  const { id_token: idToken, access_token: accessToken } = tokenResponse;
  try {
    await decodeIdToken(ctx, info, idp, idToken);
  } catch (e) {
    log.warn(`id token from ${idp.name} is invalid: ${e.message}`);
    return new Response('', {
      status: 401,
    });
  }

  const location = `${info.links.connect}/${data.state.owner}/${data.state.repo}`;
  log.info('redirect back to', location);

  return new Response('', {
    status: 302,
    headers: {
      'cache-control': 'no-store, private, must-revalidate',
      'set-cookie': setAuthCookie(info, idToken, accessToken, idp.name),
      location,
    },
  });
}

/**
 * Extracts the authentication info from the cookie. Returns {@code null} if missing or invalid.
 *
 * @param {UniversalContext} ctx
 * @param {PathInfo} info
 * @returns {Promise<AuthInfo>} the authentication info or null if the request is not authenticated
 */
export async function getAuthInfoFromCookie(request, ctx, info) {
  const { log } = ctx;
  const {
    id_token: idToken,
    idp_name: idpName,
    access_token: accessToken,
  } = getAuthCookie(info, request);
  if (idToken && idpName) {
    const idp = IDPS[idpName];
    if (!idp) {
      log.warn(`auth: unknown idp in auth token: ${idpName}`);
      return null;
    }
    try {
      const profile = await decodeIdToken(ctx, info, idp, idToken);
      profile.accessToken = accessToken;
      return profile;
    } catch (e) {
      // wrong token
      log.warn(`auth: decoding the id_token failed: ${e.message}.`);
      return null;
    }
  }
  return null;
}

/**
 * Clears the authentication cookie (todo: and redirects to the logout page of the IDP)
 * @param {UniversalContext} ctx the context of the universal serverless function
 * @param {PathInfo} info path info
 * @returns {Promise<Response>}
 */
export async function logout(ctx, info) {
  const location = info.repo && info.owner
    ? `${info.links.connect}/${info.owner}/${info.repo}`
    : info.links.connect;

  ctx.log.info('redirect back to', location);

  return new Response('', {
    status: 302,
    headers: {
      'cache-control': 'no-store, private, must-revalidate',
      'set-cookie': clearAuthCookie(info),
      location,
    },
  });
}
