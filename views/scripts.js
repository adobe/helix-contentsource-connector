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
/* eslint-env browser */
const links = {
  connect: document.getElementById('link-connect').href,
  info: document.getElementById('link-info').href,
  disconnect: document.getElementById('link-disconnect').href,
};

function showError(error) {
  if (error) {
    document.getElementById('error-text').textContent = error;
    document.getElementById('error').classList.remove('hidden');
  } else {
    document.getElementById('error').classList.add('hidden');
  }
}
function showLoading(show) {
  if (show) {
    document.getElementById('loading').classList.remove('hidden');
  } else {
    document.getElementById('loading').classList.add('hidden');
  }
}

function showInfo(data) {
  if (!data) {
    document.getElementById('info').classList.add('hidden');
  } else {
    document.getElementById('info').classList.remove('hidden');
    document.getElementById('info-title').textContent = `${data.owner} / ${data.repo}`;
    document.getElementById('info-github').href = data.githubUrl;
    document.getElementById('info-github').textContent = data.githubUrl;
    document.getElementById('info-mp').href = data.mp.url;
    document.getElementById('info-mp').textContent = data.mp.url;
    document.getElementById('info-contentBusId').textContent = data.contentBusId;
    document.getElementById('info-tenantId').textContent = data.tenantId;
  }
}

function showUserList(data) {
  if (!data) {
    document.getElementById('user-list-panel').classList.add('hidden');
  } else {
    document.getElementById('user-list-panel').classList.remove('hidden');
    const $last = document.getElementById('add-user');
    const $connected = document.getElementById('connected-user');
    const $ul = document.getElementById('user-list');
    $ul.querySelectorAll('li.user').forEach((el) => el.remove());
    $connected.classList.add('hidden');
    const opts = {};
    document.querySelectorAll('#user-name > option').forEach(($el) => {
      // eslint-disable-next-line no-param-reassign
      $el.disabled = false;
      opts[$el.value] = $el;
    });
    (data.users || []).forEach(({ name, url }) => {
      const $li = document.createElement('li');
      $li.classList.add('user');
      if (name === data.user) {
        document.getElementById('btn-disconnect').dataset.info = `${data.owner}/${data.repo}/${data.user}`;
        const $heading = document.createElement('h4');
        $heading.innerText = name;
        $li.append($heading);
        $li.append($connected);
        $connected.classList.remove('hidden');
      } else {
        const $a = document.createElement('a');
        $a.href = url;
        $a.innerText = name;
        $li.append($a);
      }
      $ul.insertBefore($li, $last);
      opts[name].disabled = true;
      delete opts[name];
    });
    if (Object.keys(opts).length === 0) {
      document.getElementById('user-name').disabled = true;
      document.getElementById('btn-add-user').disabled = true;
    } else {
      document.getElementById('user-name').disabled = false;
      document.getElementById('btn-add-user').disabled = false;
      // eslint-disable-next-line prefer-destructuring
      document.getElementById('user-name').value = Object.keys(opts)[0];
    }
    if (data.profile) {
      document.getElementById('me-displayName').textContent = data.profile.name;
      document.getElementById('me-mail').href = `mailto:${data.profile.username}`;
      document.getElementById('me-mail').textContent = data.profile.username;
      document.getElementById('info-idp').textContent = data.profile.idp;
      document.getElementById('info-issuer').textContent = data.profile.iss;
      document.getElementById('info-scopes').textContent = data.profile.scopes;
    }
    document.getElementById('btn-add-user').textContent = `Add ${data.mp.type} user`;
    document.getElementById('btn-add-user').dataset.url = data.links.login;
  }
}

function showGithubForm(show) {
  if (show) {
    document.getElementById('github-form').classList.remove('hidden');
  } else {
    document.getElementById('github-form').classList.add('hidden');
  }
}

async function loadInfo(owner, repo, user) {
  const segUser = user ? `/${user}` : '';
  const infoUrl = `${links.info}/${owner}/${repo}${segUser}`;
  const resp = await fetch(infoUrl);
  if (!resp.ok) {
    return false;
  }
  window.history.pushState({}, 'foo', `${links.connect}/${owner}/${repo}${segUser}`);
  const data = JSON.parse(await resp.text());
  // console.log(data);
  showError(data.error);
  if (data.error) {
    showInfo();
    showGithubForm(true);
    // showOnedriveConnect();
    // showGoogleConnect();
    showUserList();
  } else {
    showInfo(data);
    showGithubForm(false);
    showUserList(data);
  }
  return false;
}

async function disconnect(evt) {
  const { info } = evt.target.dataset;
  if (!info) {
    return false;
  }
  // eslint-disable-next-line no-param-reassign
  evt.target.disabled = true;
  try {
    const [owner, repo, user] = info.split('/');
    const url = `${links.disconnect}/${owner}/${repo}/${user}`;
    const resp = await fetch(url, {
      method: 'POST',
    });
    if (!resp.ok) {
      return false;
    }
    await loadInfo(owner, repo);
    return true;
  } finally {
    // eslint-disable-next-line no-param-reassign
    evt.target.disabled = false;
  }
}

async function githubForm() {
  const url = new URL(document.getElementById('github-url').value);
  const [, owner, repo] = url.pathname.split('/');
  showLoading(true);
  try {
    await loadInfo(owner, repo);
  } finally {
    showLoading(false);
  }
}

async function addUser(evt) {
  const user = document.getElementById('user-name').value;
  if (!user) {
    alert('please specify user label');
    return;
  }
  if (user.indexOf('/') >= 0) {
    alert('user label must not have \'/\'');
    return;
  }
  const url = new URL(evt.target.dataset.url);
  const state = url.searchParams.get('state');
  url.searchParams.set('state', `${state}/${user}`);
  window.location.href = url.href;
}

async function init() {
  const segs = window.location.pathname.split('/');
  const idx = segs.indexOf('connect');
  const [route, owner, repo, user] = segs.splice(idx, 4);
  if (route === 'connect' && owner && repo) {
    showLoading(true);
    try {
      await loadInfo(owner, repo, user);
    } finally {
      showLoading(false);
    }
  } else {
    showGithubForm(true);
    showInfo();
    showError();
  }
}

function registerHandlers() {
  document.getElementById('btn-connect').addEventListener('click', githubForm);
  document.getElementById('btn-add-user').addEventListener('click', addUser);
  document.getElementById('btn-disconnect').addEventListener('click', disconnect);
  window.addEventListener('popstate', init);
}

registerHandlers();
init();
