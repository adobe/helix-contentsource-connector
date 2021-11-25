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
  }
}

function showConnected(data) {
  if (!data) {
    document.getElementById('connected').classList.add('hidden');
  } else {
    document.getElementById('connected').classList.remove('hidden');
    document.getElementById('me-displayName').textContent = data.me.displayName;
    document.getElementById('me-mail').href = `mailto:${data.me.mail}`;
    document.getElementById('me-mail').textContent = data.me.mail;
    document.getElementById('btn-disconnect').data = `${data.owner}/${data.repo}/${data.me.id}`;
  }
}

function showGithubForm(show) {
  if (show) {
    document.getElementById('github-form').classList.remove('hidden');
  } else {
    document.getElementById('github-form').classList.add('hidden');
  }
}

function showOnedriveConnect(data) {
  if (data) {
    document.getElementById('connect-onedrive').classList.remove('hidden');
    document.getElementById('login-onedrive').href = data.links.odLogin;
  } else {
    document.getElementById('connect-onedrive').classList.add('hidden');
  }
}

function showGoogleConnect(data) {
  if (data) {
    document.getElementById('connect-google').classList.remove('hidden');
    document.getElementById('login-google').href = data.links.gdLogin;
  } else {
    document.getElementById('connect-google').classList.add('hidden');
  }
}

async function loadInfo(owner, repo) {
  const infoUrl = `${links.info}/${owner}/${repo}`;
  const resp = await fetch(infoUrl);
  if (!resp.ok) {
    return false;
  }
  window.history.pushState({}, 'foo', `${links.connect}/${owner}/${repo}`);
  const data = JSON.parse(await resp.text());
  console.log(data);
  showError(data.error);
  if (data.error) {
    showInfo();
    showGithubForm(true);
    showOnedriveConnect();
    showGoogleConnect();
    showConnected();
  } else {
    showInfo(data);
    showGithubForm(false);
    if (data.me) {
      showConnected(data);
      showOnedriveConnect();
      showGoogleConnect();
    } else {
      showConnected();
      if (data.mp.type === 'onedrive') {
        showOnedriveConnect(data);
      }
      if (data.mp.type === 'google') {
        showGoogleConnect(data);
      }
    }
  }
  return false;
}

async function disconnect(evt) {
  const { data } = evt.target;
  if (!data) {
    return false;
  }
  // eslint-disable-next-line no-param-reassign
  evt.target.disabled = true;
  try {
    const [owner, repo, id] = data.split('/');
    const url = `${links.disconnect}/${owner}/${repo}/${id}`;
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

async function init() {
  const segs = window.location.pathname.split('/');
  const [route, owner, repo] = segs.splice(-3);
  if (route === 'connect' && owner && repo) {
    showLoading(true);
    try {
      await loadInfo(owner, repo);
    } finally {
      showLoading(false);
    }
  } else {
    showGithubForm(true);
    showInfo();
    showOnedriveConnect();
    showGoogleConnect();
    showError();
    showConnected();
  }
}

function registerHandlers() {
  document.getElementById('btn-connect').addEventListener('click', githubForm);
  document.getElementById('btn-disconnect').addEventListener('click', disconnect);
  window.addEventListener('popstate', init);
}

registerHandlers();
init();
