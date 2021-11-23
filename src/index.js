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
import crypto from 'crypto';
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
import pkgJson from './package.cjs';
import fetchFstab from './fetch-fstab.js';
import S3CachePlugin from './S3CachePlugin.js';

const AUTH_SCOPES = ['user.read', 'openid', 'profile', 'offline_access'];

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
function getOneDriveClient(context, opts) {
  if (!context.od) {
    const { log, env } = context;
    const { owner, repo, contentBusId } = opts;
    const {
      AZURE_WORD2MD_CLIENT_ID: clientId,
      AZURE_WORD2MD_CLIENT_SECRET: clientSecret,
      AZURE_WORD2MD_TENANT: tenant = 'fa7b1b5a-7b34-4387-94ae-d2c178decee1',
    } = env;

    const key = `${contentBusId}/.helix-auth`;
    const base = process.env.AWS_EXECUTION_ENV
      ? new S3CachePlugin(context, { key, secret: contentBusId })
      : new FSCachePlugin(`.auth-${contentBusId}--${owner}--${repo}.json`).withLogger(log);
    const plugin = new MemCachePlugin(context, { key, base });

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

/**
 * Returns some information about the current project
 * @param {Request} request
 * @param {UniversalActionContext} ctx
 * @param {string} [opts.owner] owner
 * @param {string} [opts.repo] repo
 * @returns {Promise<*>} the info
 */
async function getProjectInfo(request, ctx, { owner, repo }) {
  let mp;
  let contentBusId;
  let error = '';

  if (owner && repo) {
    try {
      const fstab = await fetchFstab(ctx, {
        owner,
        repo,
        ref: 'main',
      });
      [mp] = fstab.mountpoints;

      const sha256 = crypto
        .createHash('sha256')
        .update(mp.url)
        .digest('hex');
      contentBusId = `${sha256.substr(0, 59)}`;
    } catch (e) {
      ctx.log.error('error fetching fstab:', e);
      error = e.message;
    }
  }

  return {
    owner,
    repo,
    mp,
    contentBusId,
    error,
    pkgJson,
    links: {
      helixHome: 'https://www.hlx.live/',
      disconnect: getRedirectUrl(request, ctx, `/disconnect/${owner}/${repo}`),
      connect: getRedirectUrl(request, ctx, '/connect'),
      root: getRedirectUrl(request, ctx, '/'),
    },
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

  /* ------------ token ------------------ */
  if (route === 'token') {
    const { code, state } = data;
    const [own, rep] = state.split('/');

    const info = await getProjectInfo(request, context, {
      owner: own,
      repo: rep,
    });
    if (!info.error) {
      try {
        const od = getOneDriveClient(context, info);
        await od.app.acquireTokenByCode({
          code,
          scopes: AUTH_SCOPES,
          redirectUri: getRedirectUrl(request, context, '/token'),
        });
        return new Response('', {
          status: 302,
          headers: {
            location: `${getRedirectRoot(request, context)}/connect/${own}/${rep}`,
          },
        });
      } catch (e) {
        log.error('error acquiring token', e);
        info.error = `error acquiring token: ${e.message}`;
      }
      return render('index', info);
    }
  }

  /* ------------ disconnect ------------------ */
  if (route === 'disconnect' && owner && repo) {
    const info = await getProjectInfo(request, context, {
      owner,
      repo,
    });
    if (!info.error) {
      try {
        const od = getOneDriveClient(context, info);
        const cache = od.app.getTokenCache();
        await Promise.all((await cache.getAllAccounts())
          .map(async (acc) => cache.removeAccount(acc)));
        return new Response('', {
          status: 302,
          headers: {
            location: `${getRedirectRoot(request, context)}/connect/${owner}/${repo}`,
          },
        });
      } catch (e) {
        log.error('error clearing token', e);
        info.error = `error clearing token: ${e.message}`;
      }
    }
    return render('index', info);
  }

  /* ------------ connect ------------------ */
  if (route === 'connect' && owner && repo) {
    const info = await getProjectInfo(request, context, {
      owner,
      repo,
    });
    if (!info.error) {
      try {
        if (info.mp.type === 'onedrive') {
          const od = getOneDriveClient(context, info);

          // check for token
          if (await od.getAccessToken(true)) {
            const me = await od.me();
            log.info('installed user', me);
            return render('installed', {
              ...info,
              me,
            });
          }

          // get url to sign user in and consent to scopes needed for application
          info.links.odLogin = await od.app.getAuthCodeUrl({
            scopes: AUTH_SCOPES,
            redirectUri: getRedirectUrl(request, context, '/token'),
            responseMode: 'form_post',
            prompt: 'consent',
            state: `${owner}/${repo}`,
          });
        } else if (info.mp.type === 'google') {
          // todo:
          info.links.gdLogin = 'about:blank';
        }
        return render('connect', info);
      } catch (e) {
        log.error('error during connect', e);
        info.error = e.message;
      }
    }
    return render('index', info);
  }

  const info = await getProjectInfo(request, context, {});
  return render('index', info);
}

export const main = wrap(run)
  .with(bodyData)
  .with(status)
  .with(logger);
