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
import mime from 'mime';
import { FSCachePlugin, OneDrive } from '@adobe/helix-onedrive-support';
import { google } from 'googleapis';
import wrap from '@adobe/helix-shared-wrap';
import bodyData from '@adobe/helix-shared-body-data';
import { logger } from '@adobe/helix-universal-logger';
import { wrap as status } from '@adobe/helix-status';
import { Response } from '@adobe/helix-fetch';
import MemCachePlugin from './MemCachePlugin.js';
import pkgJson from './package.cjs';
import fetchFstab from './fetch-fstab.js';
import S3CachePlugin from './S3CachePlugin.js';
import GoogleClient from './GoogleClient.js';

const AZURE_SCOPES = [
  'user.read',
  'openid',
  'profile',
  'offline_access',
];

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
];

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

function getRedirectRoot(req, ctx) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  // Checks if this is requested via admin.hlx3.page
  if (host === 'admin.hlx3.page') {
    return '/register';
  }
  //  Checks if this is requested directly to the api gateway
  if (host.endsWith('.amazonaws.com')) {
    return `/${ctx.func.package}/${ctx.func.name}/${ctx.func.version}`;
  }
  // default (eg local dev)
  return '';
}

function getRedirectUrl(req, ctx, path) {
  const rootPath = getRedirectRoot(req, ctx);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  return `${host.startsWith('localhost') ? 'http' : 'https'}://${host}${rootPath}${path}`;
}

async function getGoogleClient(req, context, opts) {
  if (!context.gc) {
    const { log, env } = context;
    const { owner, repo, contentBusId } = opts;

    const key = `${contentBusId}/.helix-auth`;
    const base = process.env.AWS_EXECUTION_ENV
      ? new S3CachePlugin(context, { key, secret: contentBusId })
      : new FSCachePlugin(`.auth-${contentBusId}--${owner}--${repo}.json`).withLogger(log);

    const plugin = new MemCachePlugin(context, { key, base });
    context.gc = await new GoogleClient({
      log,
      contentBusId,
      clientId: env.GOOGLE_HELIX_CLIENT_ID,
      clientSecret: env.GOOGLE_HELIX_CLIENT_SECRET,
      redirectUri: getRedirectUrl(req, context, '/token'),
      plugin,
    }).init();
  }
  return context.gc;
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
  let githubUrl = '';
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
      githubUrl = `https://github.com/${owner}/${repo}`;
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
    githubUrl,
    error,
    version: pkgJson.version,
    links: {
      helixHome: 'https://www.hlx.live/',
      disconnect: getRedirectUrl(request, ctx, '/disconnect'),
      connect: getRedirectUrl(request, ctx, '/connect'),
      info: getRedirectUrl(request, ctx, '/info'),
      root: getRedirectUrl(request, ctx, '/'),
      scripts: getRedirectUrl(request, ctx, '/scripts.js'),
      styles: getRedirectUrl(request, ctx, '/styles.css'),
    },
  };
}

async function serveStatic(request, context) {
  const { pathInfo: { suffix } } = context;
  const data = await readFile(resolve('views', `.${suffix}`));
  return new Response(data, {
    headers: {
      'content-type': mime.getType(suffix),
    },
  });
}

/**
 * This is the main function
 * @param {Request} request the request object (see fetch api)
 * @param {UniversalContext} context the context of the universal serverless function
 * @returns {Response} a response
 */
async function run(request, context) {
  const { log, pathInfo: { suffix }, data } = context;
  // poor mans static handling
  if (suffix === '/scripts.js' || suffix === '/styles.css') {
    return serveStatic(request, context);
  }

  const [, route, owner, repo] = suffix.split('/');

  /* ------------ token ------------------ */
  if (route === 'token') {
    const { code, state } = data;
    const [type, own, rep] = state.split('/');

    const info = await getProjectInfo(request, context, {
      owner: own,
      repo: rep,
    });
    if (!info.error) {
      try {
        if (type === 'a') {
          const od = getOneDriveClient(context, info);
          await od.app.acquireTokenByCode({
            code,
            scopes: AZURE_SCOPES,
            redirectUri: getRedirectUrl(request, context, '/token'),
          });
        } else if (type === 'g') {
          const oauth2Client = await getGoogleClient(request, context, info);
          await oauth2Client.getToken(code);
        } else {
          throw new Error(`illegal type: ${type}`);
        }

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
    if (request.method === 'GET') {
      return new Response('', {
        status: 405,
      });
    }
    const info = await getProjectInfo(request, context, {
      owner,
      repo,
    });
    if (!info.error) {
      try {
        if (info.mp.type === 'onedrive') {
          const od = getOneDriveClient(context, info);
          const cache = od.app.getTokenCache();
          await Promise.all((await cache.getAllAccounts())
            .map(async (acc) => cache.removeAccount(acc)));
        } else if (info.mp.type === 'google') {
          const oauth2Client = await getGoogleClient(request, context, info);
          await oauth2Client.setCredentials({});
        }

        return new Response('', {
          status: 200,
        });
      } catch (e) {
        log.error('error clearing token', e);
        info.error = `error clearing token: ${e.message}`;
      }
    }
    return new Response(JSON.stringify(info), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-cache, private',
      },
    });
  }

  /* ------------ info ------------------ */
  if (route === 'info' && owner && repo) {
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
            info.me = me;
          } else {
            // get url to sign user in and consent to scopes needed for application
            info.links.odLogin = await od.app.getAuthCodeUrl({
              scopes: AZURE_SCOPES,
              redirectUri: getRedirectUrl(request, context, '/token'),
              responseMode: 'form_post',
              prompt: 'consent',
              state: `a/${owner}/${repo}`,
            });
          }
        } else if (info.mp.type === 'google') {
          const googleClient = await getGoogleClient(request, context, info);
          try {
            const oauth2 = google.oauth2({ version: 'v2', auth: googleClient.client });
            const userInfo = await oauth2.userinfo.get();
            // console.log(userInfo);
            const { data: { email: mail, id } } = userInfo;
            info.me = {
              displayName: '',
              mail,
              id,
            };
            log.info('installed user', info.me);
          } catch (e) {
            // ignore
            log.info(`error reading user profile: ${e.message}`);
          }
          if (!info.me) {
            info.links.gdLogin = await googleClient.generateAuthUrl({
              scope: GOOGLE_SCOPES,
              access_type: 'offline',
              prompt: 'consent',
              state: `g/${owner}/${repo}`,
            });
          }
        }
      } catch (e) {
        log.error('error during info', e);
        info.error = e.message;
      }
    }
    return new Response(JSON.stringify(info), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-cache, private',
      },
    });
  }

  const info = await getProjectInfo(request, context, {});
  return render('index', info);
}

export const main = wrap(run)
  .with(bodyData)
  .with(status)
  .with(logger);
