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
import fetchFstab from './fetch-fstab.js';

const AUTH_SCOPES = ['user.read', 'openid', 'profile', 'offline_access'];

let pkgJson;
async function getPackageJson() {
  if (!pkgJson) {
    pkgJson = JSON.parse(await readFile('package.json', 'utf-8'));
  }
  return pkgJson;
}

/* ---- ejs --- */
ejs.resolveInclude = (name) => resolve('views', `${name}.ejs`);

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

/**
 * @param context
 * @returns {OneDrive}
 */
function getOneDriveClient(context, { owner, repo }) {
  if (!context.od) {
    const { log, env } = context;
    const {
      AZURE_WORD2MD_CLIENT_ID: clientId,
      AZURE_WORD2MD_CLIENT_SECRET: clientSecret,
      AZURE_WORD2MD_TENANT: tenant = 'fa7b1b5a-7b34-4387-94ae-d2c178decee1',
    } = env;

    const plugin = process.env.AWS_EXECUTION_ENV
      ? new MemCachePlugin(`${owner}--${repo}`)
      : new FSCachePlugin(`.auth-${owner}--${repo}.json`).withLogger(log);

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
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  return host.endsWith('.amazonaws.com');
}

function getRedirectRoot(req, ctx) {
  return isDirectAWS(req)
    ? `/${ctx.func.package}/${ctx.func.name}/${ctx.func.version}`
    : '';
}

function getRedirectUrl(req, ctx, path) {
  const rootPath = getRedirectRoot(req, ctx);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  return `${host.startsWith('localhost') ? 'http' : 'https'}://${host}${rootPath}${path}`;
}

async function getProjectInfo(ctx, owner, repo) {
  const fstab = await fetchFstab(ctx, {
    owner,
    repo,
    ref: 'main',
  });
  return {
    owner,
    repo,
    mp: fstab.mountpoints[0],
    error: '',
  };
}

/**
 * This is the main function
 * @param {Request} request the request object (see fetch api)
 * @param {UniversalContext} context the context of the universal serverless function
 * @returns {Response} a response
 */
async function run(request, context) {
  const { log, pathInfo: { suffix }, data } = context;
  const [, route, owner, repo] = suffix.split('/');
  if (route === 'token') {
    const { code, state } = data;
    const [own, rep] = state.split('/');
    // todo: validate state

    const tokenRequest = {
      code,
      scopes: AUTH_SCOPES,
      redirectUri: getRedirectUrl(request, context, '/token'),
    };

    const od = getOneDriveClient(context, { owner: own, repo: rep });
    await od.app.acquireTokenByCode(tokenRequest);
    // todo: show error page
    return new Response('', {
      status: 302,
      headers: {
        location: `${getRedirectRoot(request, context)}/connect/${own}/${rep}`,
      },
    });
  }

  const templateData = {
    pkgJson: await getPackageJson(),
    repo,
    owner,
    links: {
      helixHome: 'https://www.hlx.live/',
      disconnect: getRedirectUrl(request, context, `/disconnect/${owner}/${repo}`),
      connect: getRedirectUrl(request, context, '/connect'),
      root: getRedirectUrl(request, context, '/'),
    },
  };

  if (route === 'disconnect' && owner && repo) {
    const od = getOneDriveClient(context, { owner, repo });
    const cache = od.app.getTokenCache();
    await Promise.all((await cache.getAllAccounts())
      .map(async (info) => cache.removeAccount(info)));

    return new Response('', {
      status: 302,
      headers: {
        location: `${getRedirectRoot(request, context)}/connect/${owner}/${repo}`,
      },
    });
  }

  if (route === 'connect' && owner && repo) {
    templateData.info = await getProjectInfo(context, owner, repo);
    if (templateData.info.mp.type === 'onedrive') {
      const od = getOneDriveClient(context, { owner, repo });

      // check for token
      if (await od.getAccessToken(true)) {
        const me = await od.me();
        log.info('installed user', me);
        return render('installed', { ...templateData, me });
      }

      const authCodeUrlParameters = {
        scopes: AUTH_SCOPES,
        redirectUri: getRedirectUrl(request, context, '/token'),
        responseMode: 'form_post',
        prompt: 'consent',
        state: `${owner}/${repo}`,
      };

      // get url to sign user in and consent to scopes needed for application
      templateData.links.odLogin = await od.app.getAuthCodeUrl(authCodeUrlParameters);
    } else if (templateData.info.mp.type === 'google') {
      // todo:
      templateData.linksgdLogin = 'about:blank';
    }

    return render('connect', templateData);
  }

  return render('index', templateData);
}

export const main = wrap(run)
  .with(bodyData)
  .with(status)
  .with(logger);
