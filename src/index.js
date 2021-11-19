/*
 * Copyright 2021 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import ejs from 'ejs';
import { FSCachePlugin, OneDrive } from '@adobe/helix-onedrive-support';
import wrap from '@adobe/helix-shared-wrap';
import bodyData from '@adobe/helix-shared-body-data';
import { logger } from '@adobe/helix-universal-logger';
import { wrap as status } from '@adobe/helix-status';
import { Response } from '@adobe/helix-universal';
import MemCachePlugin from './MemCachePlugin.js';

const AUTH_SCOPES = ['user.read', 'openid', 'profile', 'offline_access'];

let pkgJson;
async function getPackageJson() {
  if (!pkgJson) {
    pkgJson = JSON.parse(await readFile('package.json', 'utf-8'));
  }
  return pkgJson;
}

const templates = {};

async function getTemplate(name) {
  if (!(name in templates)) {
    const str = await readFile(resolve('views', `${name}.ejs`), 'utf-8');
    templates[name] = ejs.compile(str);
  }
  return templates[name];
}

async function render(name, data) {
  const tpl = await getTemplate(name);
  return new Response(tpl(data), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
    },
  });
}

const memCachePlugin = new MemCachePlugin();

/**
 * @param context
 * @returns {OneDrive}
 */
function getOneDriveClient(context) {
  if (!context.od) {
    const { log, env } = context;
    const {
      AZURE_WORD2MD_CLIENT_ID: clientId,
      AZURE_WORD2MD_CLIENT_SECRET: clientSecret,
      AZURE_WORD2MD_TENANT: tenant = 'fa7b1b5a-7b34-4387-94ae-d2c178decee1',
    } = env;

    const plugin = process.env.AWS_EXECUTION_ENV
      ? memCachePlugin
      : new FSCachePlugin('.auth.json').withLogger(log);

    context.od = new OneDrive({
      clientId,
      tenant,
      clientSecret,
      log,
      localAuthCache: {
        plugin,
      },
    });
  }
  return context.od;
}

/**
 * Checks if this is requested directly to the api gateway
 * @param {Request} req the request
 * @returns {boolean} if requested directly via api gatewat
 */
function isDirectAWS(req) {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  return host.endsWith('.amazonaws.com');
}

function getRedirectRoot(req, ctx) {
  return isDirectAWS(req)
    ? `/${ctx.func.package}/${ctx.func.name}/${ctx.func.version}`
    : '';
}

function getRedirectUrl(req, ctx, path) {
  const rootPath = getRedirectRoot(req, ctx);
  const host = /* req.headers.get('x-forwarded-host') || */ req.headers.get('host');
  return `${host.startsWith('localhost') ? 'http' : 'https'}://${host}${rootPath}${path}`;
}

/**
 * This is the main function
 * @param {Request} request the request object (see fetch api)
 * @param {UniversalContext} context the context of the universal serverless function
 * @returns {Response} a response
 */
async function run(request, context) {
  const { pathInfo: { suffix }, data } = context;

  if (suffix === '/token') {
    const tokenRequest = {
      code: data.code,
      scopes: AUTH_SCOPES,
      redirectUri: getRedirectUrl(request, context, '/token'),
    };

    const od = getOneDriveClient(context);
    await od.app.acquireTokenByCode(tokenRequest);
    // todo: show error page
    return new Response('', {
      status: 302,
      headers: {
        location: `${getRedirectRoot(request, context)}/`,
      },
    });
  }

  if (suffix === '/reset') {
    const od = getOneDriveClient(context);
    const cache = od.app.getTokenCache();
    await Promise.all((await cache.getAllAccounts())
      .map(async (info) => cache.removeAccount(info)));

    return new Response('', {
      status: 302,
      headers: {
        location: `${getRedirectRoot(request, context)}/`,
      },
    });
  }

  const od = getOneDriveClient(context);
  const templateData = {
    pkgJson: await getPackageJson(),
    links: {
      helixHome: 'https://www.hlx.live/',
      reset: getRedirectUrl(request, context, '/reset'),
    },
  };

  // check for token
  if (await od.getAccessToken(true)) {
    const me = await od.me();
    return render('installed', { ...templateData, me });
  }

  const authCodeUrlParameters = {
    scopes: AUTH_SCOPES,
    redirectUri: getRedirectUrl(request, context, '/token'),
  };

  // get url to sign user in and consent to scopes needed for application
  templateData.links.odLogin = await od.app.getAuthCodeUrl(authCodeUrlParameters);
  return render('index', templateData);
}

export const main = wrap(run)
  .with(bodyData)
  .with(status)
  .with(logger);
