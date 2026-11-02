const form = document.getElementById('form');
const urlInput = document.getElementById('url');
const jobEl = document.getElementById('job');
const jobIdEl = document.getElementById('jobId');
const statusEl = document.getElementById('status');
const openEl = document.getElementById('open');
const recentEl = document.getElementById('recent');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();

  jobEl.hidden = false;
  jobIdEl.textContent = '…';
  statusEl.textContent = 'starting';
  openEl.hidden = true;

  // First call: create job, do one slice
  let r = await fetch('/api/build', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  let data = await r.json();
  if (data.error) return (statusEl.textContent = 'error: ' + data.error);

  const id = data.id;
  jobIdEl.textContent = id;
  statusEl.textContent = `${data.pages} pages, ${data.queued} queued, ${data.apiCalls} api`;

  // Continue until done
  while (data.status !== 'done') {
    await new Promise(r => setTimeout(r, 800));
    r = await fetch('/api/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ continue: true, id }),
    });
    data = await r.json();
    if (data.error) { statusEl.textContent = 'error: ' + data.error; return; }
    statusEl.textContent = `${data.pages} pages, ${data.queued} queued, ${data.apiCalls} api`;
  }

  statusEl.textContent = `done — ${data.pages} pages, ${data.apiCalls} api calls`;
  openEl.href = `/m/${id}/`;
  openEl.hidden = false;
  refreshRecent();
});

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
    s.textContent = `${j.status} · ${j.pages}p · ${j.apiCalls}api`;
    li.appendChild(a);
    li.appendChild(s);
    recentEl.appendChild(li);
  }
}
refreshRecent();