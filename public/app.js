const form = document.getElementById('form');
const urlInput = document.getElementById('url');
const maxPages = document.getElementById('maxPages');
const jobEl = document.getElementById('job');
const jobIdEl = document.getElementById('jobId');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const openEl = document.getElementById('open');
const recentEl = document.getElementById('recent');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  const r = await fetch('/api/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, maxPages: Number(maxPages.value) }),
  });
  const { id, error } = await r.json();
  if (error) return alert(error);

  jobEl.hidden = false;
  jobIdEl.textContent = id;
  statusEl.textContent = 'running…';
  logEl.textContent = '';
  openEl.hidden = true;

  poll(id);
});

async function poll(id) {
  while (true) {
    const r = await fetch('/api/job/' + id);
    const j = await r.json();
    if (j.progress) {
      logEl.textContent = JSON.stringify(j.progress, null, 2);
    }
    if (j.status === 'done') {
      statusEl.textContent = `done — ${j.result.pages} pages, ${j.result.apiCalls} API responses captured`;
      openEl.href = '/m/' + id + '/';
      openEl.hidden = false;
      refreshRecent();
      return;
    }
    if (j.status === 'error') {
      statusEl.textContent = 'error: ' + j.error;
      return;
    }
    await new Promise(r => setTimeout(r, 800));
  }
}

async function refreshRecent() {
  const r = await fetch('/api/jobs');
  const list = await r.json();
  recentEl.innerHTML = '';
  for (const j of list.reverse()) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '/m/' + j.id + '/';
    a.textContent = j.startUrl;
    const s = document.createElement('small');
    s.textContent = j.status + (j.result ? ` · ${j.result.pages}p / ${j.result.apiCalls}api` : '');
    li.appendChild(a);
    li.appendChild(s);
    recentEl.appendChild(li);
  }
}

refreshRecent();