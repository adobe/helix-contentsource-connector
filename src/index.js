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
import {
  MemCachePlugin, OneDriveAuth, FSCacheManager, S3CacheManager, OneDrive,
} from '@adobe/helix-onedrive-support';
import { GoogleClient } from '@adobe/helix-google-support';
import { google } from 'googleapis';
import wrap from '@adobe/helix-shared-wrap';
import bodyData from '@adobe/helix-shared-body-data';
import { logger } from '@adobe/helix-universal-logger';
import { wrap as status } from '@adobe/helix-status';
import { Response } from '@adobe/helix-fetch';
import { decodeJwt, UnsecuredJWT } from 'jose';
import pkgJson from './package.cjs';
import fetchFstab from './fetch-fstab.js';
import {
  exchangeToken, getAuthInfoFromCookie, IDPS, logout, redirectToLogin,
} from './login.js';

const ROOT_PATH = '/register';

const AZURE_SCOPES = [
  'user.read',
  'openid',
  'profile',
  'offline_access',
  'Files.ReadWrite.All',
  'Sites.ReadWrite.All',
];

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
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

function getRedirectRoot(req, ctx) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  //  Checks if this is requested directly to the api gateway
  if (host.endsWith('.amazonaws.com')) {
    return `/${ctx.func.package}/${ctx.func.name}/${ctx.func.version}${ROOT_PATH}`;
  }
  // default
  return ROOT_PATH;
}

function getRedirectUrl(req, ctx, path) {
  const rootPath = getRedirectRoot(req, ctx);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  return `${host.startsWith('localhost') ? 'http' : 'https'}://${host}${rootPath}${path}`;
}

async function getCachePlugin(context, opts) {
  const { log } = context;
  const {
    user, contentBusId, cacheManager, repo,
  } = opts;
  if (!user) {
    return null;
  }
  const key = `${contentBusId}/${repo}/${user}`;
  const base = await cacheManager.getCache(user);
  return new MemCachePlugin({ log, key, base });
}

/**
 * @param context
 * @returns {OneDriveAuth}
 */
async function getOneDriveClient(context, opts) {
  if (!context.od) {
    const { log, env } = context;
    const {
      AZURE_WORD2MD_CLIENT_ID: clientId,
      AZURE_WORD2MD_CLIENT_SECRET: clientSecret,
    } = env;
    const cachePlugin = await getCachePlugin(context, opts);

    context.od = new OneDriveAuth({
      log,
      clientId,
      clientSecret,
      cachePlugin,
    });

    // init tenant via mount point
    await context.od.initTenantFromMountPoint(opts.mp);
  }

  // this is a bit a hack
  // eslint-disable-next-line no-param-reassign
  opts.tenantId = context.od.tenant;
  return context.od;
}

async function getGoogleClient(req, context, opts) {
  if (!context.gc) {
    const { log, env } = context;
    const cachePlugin = await getCachePlugin(context, opts);

    context.gc = await new GoogleClient({
      log,
      clientId: env.GOOGLE_DOCS2MD_CLIENT_ID,
      clientSecret: env.GOOGLE_DOCS2MD_CLIENT_SECRET,
      redirectUri: getRedirectUrl(req, context, '/token'),
      cachePlugin,
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
 * @param {string} [opts.user] user
 * @returns {Promise<*>} the info
 */
async function getProjectInfo(request, ctx, { owner, repo, user }) {
  let mp;
  let contentBusId;
  let githubUrl = '';
  let error = '';
  let cacheManager;

  if (owner && repo) {
    if (owner === 'default' && repo === 'onedrive') {
      // workaround to register default onedrive user
      contentBusId = 'default';
      mp = {
        type: 'onedrive',
        url: 'https://adobe.sharepoint.com/sites/cg-helix/Shared%20Documents',
      };
    } else if (owner === 'default' && repo === 'google') {
      // workaround to register default onedrive user
      contentBusId = 'default';
      mp = {
        type: 'google',
        url: 'https://drive.google.com/drive/u/3/folders/18G2V_SZflhaBrSo_0fMYqhGaEF9Vetkz',
        id: '18G2V_SZflhaBrSo_0fMYqhGaEF9Vetkz',
      };
    } else {
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

    cacheManager = process.env.AWS_EXECUTION_ENV
      ? new S3CacheManager({
        log: ctx.log,
        prefix: `${contentBusId}/.helix-auth`,
        secret: contentBusId,
        bucket: 'helix-content-bus',
        type: mp?.type,
      })
      : new FSCacheManager({
        log: ctx.log,
        dirPath: `.auth-${contentBusId}--${owner}--${repo}`,
        type: mp?.type,
      });
  }

  const ret = {
    owner,
    repo,
    user,
    mp,
    contentBusId,
    githubUrl,
    tenantId: '',
    error,
    version: pkgJson.version,
    profile: null, // profile of connected user
    authInfo: null, // profile of signed in user
    links: {
      helixHome: 'https://www.hlx.live/',
      disconnect: getRedirectUrl(request, ctx, '/disconnect'),
      connect: getRedirectUrl(request, ctx, '/connect'),
      info: getRedirectUrl(request, ctx, '/info'),
      token: getRedirectUrl(request, ctx, '/token'),
      login: getRedirectUrl(request, ctx, '/login'),
      logout: getRedirectUrl(request, ctx, '/logout'),
      root: getRedirectUrl(request, ctx, '/'),
      scripts: getRedirectUrl(request, ctx, '/scripts.js'),
      styles: getRedirectUrl(request, ctx, '/styles.css'),
    },
  };
  return Object.defineProperty(ret, 'cacheManager', {
    value: cacheManager,
    enumerable: false,
  });
}

async function serveStatic(path) {
  const data = await readFile(resolve('views', `.${path}`));
  return new Response(data, {
    headers: {
      'content-type': mime.getType(path),
    },
  });
}

async function testReadAccessGoogle(ctx, info, client) {
  const { log } = ctx;
  try {
    const ancestors = await client.getItemsFromId(info.mp.id, []);
    if (ancestors.length > 0) {
      log.info(`access validated. user can access ${ancestors[0].id}`);
      return '';
    }
    return 'Unable to validate access: Sharelink invalid or not authorized.';
  } catch (e) {
    log.warn('unable to resolve sharelink', e);
    return `Unable to validate access: ${e.message}`;
  }
}

async function testReadAccessOnedrive(ctx, info, client) {
  const { log } = ctx;
  try {
    const root = await client.resolveShareLink(info.mp.url);
    log.info(`access validated. user can access ${root.webUrl}`);
  } catch (e) {
    log.warn('unable to resolve sharelink', e);
    if (e.details.code === 'accessDenied') {
      return `Not authorized to access underlying data source. Please make sure that the enterprise application: "Helix Service (${client.auth.clientId})" is consented for the required scopes.`;
    } else {
      return `Unable to validate access: ${e.message}`;
    }
  }
  return '';
}

/**
 * Tests if the `authInfo` user has access to the share url.
 * we might want to check for the `/.helix/config.xlsx` in the future
 * @param ctx
 * @param info
 * @returns {Promise<string>}
 */
async function authorizeAccess(ctx, info) {
  const { log, env } = ctx;
  if (!info.authInfo?.accessToken) {
    return 'no access_token provided';
  }

  if (info.mp.type === 'google') {
    const gc = await new GoogleClient({
      log,
      clientId: env.GOOGLE_DOCS2MD_CLIENT_ID,
      clientSecret: env.GOOGLE_DOCS2MD_CLIENT_SECRET,
    }).init();
    await gc.setCredentials({
      scope: GOOGLE_SCOPES.join(' '),
      access_token: info.authInfo.accessToken,
    });
    return testReadAccessGoogle(ctx, info, gc);
  } else {
    const {
      AZURE_WORD2MD_CLIENT_ID: clientId,
      AZURE_WORD2MD_CLIENT_SECRET: clientSecret,
    } = env;
    const auth = new OneDriveAuth({
      log,
      clientId,
      clientSecret,
      tenant: info.tenantId,
    });
    auth.setAccessToken(info.authInfo.accessToken);
    const od = new OneDrive({
      auth,
      noShareLinkCache: true,
    });
    return testReadAccessOnedrive(ctx, info, od);
  }
}

/**
 * This is the main function
 * @param {Request} request the request object (see fetch api)
 * @param {UniversalContext} context the context of the universal serverless function
 * @returns {Response} a response
 */
async function run(request, context) {
  const { log, pathInfo: { suffix }, data } = context;
  if (!suffix.startsWith(ROOT_PATH)) {
    return new Response('', {
      status: 404,
    });
  }
  const path = suffix.substring(ROOT_PATH.length);

  // poor mans static handling
  if (path === '/scripts.js' || path === '/styles.css') {
    return serveStatic(path);
  }

  const [, route, owner, repo, user] = path.split('/');

  /* ------------ login ------------------ */
  if (route === 'login' && owner && repo) {
    const info = await getProjectInfo(request, context, {
      owner,
      repo,
      user,
    });
    // init tenantId for onedrive
    if (info.mp.type === 'onedrive') {
      await getOneDriveClient(context, info);
    }
    if (!info.error) {
      return redirectToLogin(context, info, IDPS[info.mp.type]);
    }
  }

  /* ------------ logout ------------------ */
  if (route === 'logout') {
    const info = await getProjectInfo(request, context, {
      owner,
      repo,
      user,
    });
    return logout(context, info);
  }

  /* ------------ token ------------------ */
  if (route === 'token') {
    // this is a hack
    const [state, usr] = (data.state || '').split(':');
    data.state = decodeJwt(state);
    data.state.user = usr;
    const { code } = data;
    const {
      type, idp, owner: own, repo: rep, tid,
    } = data.state;

    const info = await getProjectInfo(request, context, {
      owner: own,
      repo: rep,
      user: usr,
    });
    info.tenantId = tid;

    if (!code) {
      log.warn('unable to acquire token: no code parameter provided.');
      return new Response('', {
        status: 302,
        headers: {
          location: `${getRedirectRoot(request, context)}/connect/${own}/${rep}/${usr}`,
        },
      });
    }

    if (!info.error) {
      try {
        if (type === 'connect' && idp === 'onedrive') {
          const od = await getOneDriveClient(context, info);
          await od.app.acquireTokenByCode({
            code,
            scopes: AZURE_SCOPES,
            redirectUri: getRedirectUrl(request, context, '/token'),
          });
        } else if (type === 'connect' && idp === 'google') {
          const oauth2Client = await getGoogleClient(request, context, info);
          await oauth2Client.getToken(code);
        } else if (type === 'login') {
          return exchangeToken(context, info, IDPS[idp]);
        } else {
          throw new Error(`illegal type: ${idp}`);
        }

        return new Response('', {
          status: 302,
          headers: {
            location: `${getRedirectRoot(request, context)}/connect/${own}/${rep}/${usr}`,
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
  if (route === 'disconnect' && owner && repo && user) {
    if (request.method === 'GET') {
      return new Response('', {
        status: 405,
      });
    }
    const info = await getProjectInfo(request, context, {
      owner,
      repo,
      user,
    });

    info.authInfo = await getAuthInfoFromCookie(request, context, info);
    const authError = await authorizeAccess(context, info);
    if (authError) {
      log.warn('unable to disconnect:', authError);
      return new Response('', {
        status: 401,
      });
    }

    if (!info.error) {
      try {
        if (info.mp.type === 'onedrive') {
          const od = await getOneDriveClient(context, info);
          await od.cachePlugin.deleteCache();
        } else if (info.mp.type === 'google') {
          const gc = await getGoogleClient(request, context, info);
          await gc.cachePlugin.deleteCache();
        }
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
      user,
    });
    info.authInfo = await getAuthInfoFromCookie(request, context, info);
    if (!info.authInfo) {
      delete info.mp;
      delete info.contentBusId;
    } else {
      info.error = await authorizeAccess(context, info);
      delete info.accessToken;
      if (info.error) {
        delete info.mp;
        delete info.contentBusId;
      }
    }

    if (!info.error && info.authInfo) {
      try {
        const cacheKeys = await info.cacheManager.listCacheKeys();
        info.users = cacheKeys.map((name) => ({
          name,
          url: getRedirectUrl(request, context, `/connect/${owner}/${repo}/${name}`),
        }));

        const state = new UnsecuredJWT({
          type: 'connect',
          idp: info.mp.type,
          owner,
          repo,
        }).encode();

        if (info.mp.type === 'onedrive') {
          const od = await getOneDriveClient(context, info);
          // get url to sign user in and consent to scopes needed for application
          info.links.login = await od.app.getAuthCodeUrl({
            scopes: AZURE_SCOPES,
            redirectUri: getRedirectUrl(request, context, '/token'),
            responseMode: 'form_post',
            prompt: 'select_account',
            state,
          });
          if (user) {
            // check for token
            const authResult = await od.authenticate(true);
            // console.log(authResult);
            if (authResult) {
              info.profile = {
                name: authResult.account.name,
                username: authResult.account.username,
                scopes: authResult.scopes,
                idp: authResult.idTokenClaims.idp,
                iss: authResult.idTokenClaims.iss,
              };
              const client = new OneDrive({
                auth: od,
                noShareLinkCache: true,
              });
              info.testReadAccess = await testReadAccessOnedrive(context, info, client);
            } else {
              log.info('not authenticated');
            }
          }
        } else if (info.mp.type === 'google') {
          const googleClient = await getGoogleClient(request, context, info);
          info.links.login = await googleClient.generateAuthUrl({
            scope: GOOGLE_SCOPES,
            access_type: 'offline',
            prompt: 'consent',
            state,
          });
          if (user) {
            try {
              const oauth2 = google.oauth2({ version: 'v2', auth: googleClient.auth });
              const userInfo = await oauth2.userinfo.get();
              // console.log(userInfo);
              const { data: { email: mail, name, hd } } = userInfo;
              info.profile = {
                name,
                username: mail,
                idp: hd,
                iss: '',
                scopes: GOOGLE_SCOPES,
              };
              info.testReadAccess = await testReadAccessGoogle(context, info, googleClient);
            } catch (e) {
              // ignore
              log.info(`error reading user profile: ${e.message}`);
            }
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
