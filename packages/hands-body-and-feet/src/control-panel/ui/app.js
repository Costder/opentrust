/**
 * Agent OS Control Panel — vanilla JS application shell.
 * No framework, no build step. Sidebar routing, toasts, live
 * dashboard, plus the original control bindings + event bus.
 */

(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────
  const state = {
    killed: false,
    mission: '',
    role: 'shopkeeper',
    spendCaps: { perCall: 1.0, daily: 25, monthly: 200 },
    strategyEnabled: false,
    strategyHorizon: 'weekly',
    localMode: false,
    harnesses: { hermes: false, openclaw: false, codex: false, claude: true },
    registryUrl: 'https://opentrust.sh/api/v1',
    view: 'overview',
  };

  const $ = (id) => document.getElementById(id);
  const MODE_META = {
    manager:    { tier: 1, sub: 'Tier 1 · careful, approval-heavy' },
    operator:   { tier: 2, sub: 'Tier 2 · hands-on execution' },
    shopkeeper: { tier: 3, sub: 'Tier 3 · hands-off ops' },
    founder:    { tier: 4, sub: 'Tier 4 · continuous autonomy' },
  };
  const TIER_COLOR = {
    manager: 'var(--tier-1)', operator: 'var(--tier-2)',
    shopkeeper: 'var(--tier-3)', founder: 'var(--tier-4)',
  };

  // ── Status bar ───────────────────────────────────────────
  const statusText = $('status-text');
  const statusDot = $('status-dot');
  function setStatus(text, dotClass) {
    if (statusText) statusText.textContent = text;
    if (statusDot) {
      statusDot.className = 'status-dot';
      if (dotClass) statusDot.classList.add(dotClass);
    }
  }

  // ── Toasts ───────────────────────────────────────────────
  const toastWrap = $('toast-container');
  const TOAST_ICON = { default: '▸', danger: '■', warn: '⚠', info: 'ⓘ' };
  function toast(title, msg, type) {
    if (!toastWrap) return;
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.innerHTML =
      '<span class="toast-ico">' + (TOAST_ICON[type] || TOAST_ICON.default) + '</span>' +
      '<div class="toast-body"><div class="toast-title"></div>' +
      (msg ? '<div class="toast-msg"></div>' : '') + '</div>';
    el.querySelector('.toast-title').textContent = title;
    if (msg) el.querySelector('.toast-msg').textContent = msg;
    toastWrap.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 260);
    }, 3200);
  }

  // ── Activity timeline ────────────────────────────────────
  function nowHM() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function logEvent(type, text, sev) {
    const list = $('timeline');
    if (!list) return;
    const li = document.createElement('li');
    li.className = 'tl-item fresh';
    li.setAttribute('data-sev', sev || 'info');
    li.innerHTML =
      '<span class="tl-dot"></span><span class="tl-time">' + nowHM() +
      '</span><span class="tl-type">' + type + '</span><span class="tl-text"></span>';
    li.querySelector('.tl-text').textContent = text;
    list.insertBefore(li, list.firstChild);
    while (list.children.length > 12) list.removeChild(list.lastChild);
  }

  // ── Router ───────────────────────────────────────────────
  const VIEWS = {
    overview:        { title: 'Mission Control', sub: 'Live overview of agent activity' },
    missions:        { title: 'Missions', sub: 'Long-running and parallel missions' },
    'mission-detail':{ title: 'Mission', sub: 'Plan, timeline, decisions, spend, and agents' },
    decisions:       { title: 'Decisions', sub: 'The major branch points — distinct from the log' },
    agents:          { title: 'Agents', sub: 'Agent instances and their history' },
    budget:          { title: 'Budget & Caps', sub: 'Hard spend limits the agent cannot exceed' },
    strategy:        { title: 'Strategy', sub: 'Long-horizon planning and rerouting' },
    harnesses:       { title: 'Harnesses', sub: 'Runtimes the agent loop runs in' },
    marketplace:     { title: 'OpenTrust', sub: 'Trust, passports, jobs, and reviews' },
    settings:        { title: 'Settings', sub: 'Local mode and registry configuration' },
  };
  const shell = document.querySelector('.app-shell');

  function setView(name) {
    if (!VIEWS[name]) name = 'overview';
    state.view = name;
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    const view = $('view-' + name);
    if (view) view.classList.add('active');
    document.querySelectorAll('.nav-item').forEach((n) => {
      n.classList.toggle('active', n.getAttribute('data-view') === name);
    });
    const meta = VIEWS[name];
    if ($('view-title')) $('view-title').textContent = meta.title;
    if ($('view-sub')) $('view-sub').textContent = meta.sub;
    if (history.replaceState) history.replaceState(null, '', '#' + name);
    else location.hash = name;
    if (name === 'overview') refreshOverview();
    if (name === 'missions') renderMissions();
    if (name === 'decisions') renderDecisions();
    if (name === 'agents') renderAgents();
    if (shell) shell.classList.remove('nav-open');
    const scroller = document.querySelector('.view-scroll');
    if (scroller) scroller.scrollTop = 0;
  }

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.getAttribute('data-view')));
  });
  // Support direct hash navigation (deep links, manual hash edits).
  window.addEventListener('hashchange', () => {
    const v = (location.hash || '').replace('#', '');
    if (VIEWS[v] && v !== state.view) setView(v);
  });

  // sidebar collapse + mobile toggle
  if ($('sb-collapse') && shell) {
    $('sb-collapse').addEventListener('click', () => shell.classList.toggle('collapsed'));
  }
  if ($('sb-toggle') && shell) {
    $('sb-toggle').addEventListener('click', () => shell.classList.toggle('nav-open'));
  }

  // ── Overview (fully live — everything is read from the local store) ──────
  function updateSystemToggles() {
    if ($('sys-local')) { $('sys-local').textContent = state.localMode ? 'on' : 'off'; $('sys-local').classList.toggle('off', !state.localMode); }
    if ($('sys-strategy')) { $('sys-strategy').textContent = state.strategyEnabled ? 'on' : 'off'; $('sys-strategy').classList.toggle('off', !state.strategyEnabled); }
  }
  function setMissionStat(label, running) {
    if ($('stat-mission')) $('stat-mission').textContent = label;
    if ($('stat-mission-dot')) $('stat-mission-dot').className = 'stat-dot ' + (running ? 'running' : 'idle');
  }

  async function refreshOverview() {
    updateSystemToggles();
    let status = null, missions = null, events = null;
    try { status = await api('/api/local/status'); } catch (e) { /* offline */ }
    try { missions = (await api('/api/local/missions')).missions || []; } catch (e) { missions = null; }
    try { events = (await api('/api/local/events')).events || []; } catch (e) { events = null; }

    // Registry + harnesses (live, from /api/local/status)
    if (status && $('sys-registry')) $('sys-registry').textContent = shortUrl(status.registryUrl || state.registryUrl);
    if (status && status.harnesses) {
      const hs = status.harnesses;
      const detected = Object.keys(hs).filter((k) => hs[k] && hs[k].detected);
      if ($('stat-harnesses')) $('stat-harnesses').textContent = detected.length;
      if ($('stat-harnesses-sub')) $('stat-harnesses-sub').textContent = detected.length
        ? detected.map((k) => hs[k].label || cap(k)).join(', ') : 'none detected';
    }

    // Mission portfolio — Mode, Mission count, Active Mission list, Spend cap denominator
    if (missions) {
      const running = missions.filter((m) => m.status === 'running');
      const pool = running.length ? running : missions;
      const counts = {};
      pool.forEach((m) => { counts[m.mode] = (counts[m.mode] || 0) + 1; });
      const dominant = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      if ($('stat-mode')) $('stat-mode').textContent = dominant ? cap(dominant) : '—';
      if ($('stat-mode-sub')) $('stat-mode-sub').textContent = dominant ? ((MODE_META[dominant] && MODE_META[dominant].sub) || '') : 'No missions';
      if ($('stat-mode-dot')) {
        $('stat-mode-dot').className = 'stat-dot ' + (dominant ? '' : 'idle');
        if (dominant) { $('stat-mode-dot').style.background = TIER_COLOR[dominant]; $('stat-mode-dot').style.boxShadow = '0 0 9px ' + TIER_COLOR[dominant]; }
      }

      if ($('stat-mission')) $('stat-mission').textContent = running.length ? String(running.length) : (missions.length ? '0' : 'Idle');
      if ($('stat-mission-dot')) $('stat-mission-dot').className = 'stat-dot ' + (running.length ? 'running' : 'idle');
      if ($('stat-mission-sub')) $('stat-mission-sub').textContent = missions.length ? (running.length + ' running · ' + missions.length + ' total') : 'No mission deployed';

      const totalDaily = missions.reduce((t, m) => t + ((m.budget && m.budget.daily) || 0), 0);
      if ($('stat-spend-cap')) $('stat-spend-cap').textContent = totalDaily;

      const empty = $('active-mission-empty'); const text = $('active-mission-text');
      if (missions.length) {
        if (empty) empty.classList.add('hidden');
        if (text) {
          text.classList.remove('hidden');
          text.innerHTML = missions.slice(0, 5).map((m) =>
            '<div class="om-row" data-mission="' + m.missionId + '"><span class="pill pill-' + m.status + '">' + (STATUS_LABEL[m.status] || m.status) + '</span><span class="om-title">' + esc(m.title) + '</span></div>'
          ).join('');
          text.querySelectorAll('.om-row').forEach((r) => r.addEventListener('click', () => openMission(r.getAttribute('data-mission'))));
        }
      } else {
        if (empty) empty.classList.remove('hidden');
        if (text) { text.classList.add('hidden'); text.innerHTML = ''; }
      }

      renderApprovals(missions.filter((m) => m.status === 'waiting_approval'));
    }

    // Spend value (live, summed from spend events) + the activity feed
    if (events) {
      const spent = events.filter((e) => e.type === 'spend').reduce((t, e) => t + (Number(e.data && e.data.amount) || 0), 0);
      if ($('stat-spend')) $('stat-spend').textContent = (Math.round(spent * 100) / 100).toFixed(2);
      const spendCap = parseFloat($('stat-spend-cap') ? $('stat-spend-cap').textContent : '0') || 0;
      if ($('stat-spend-bar')) $('stat-spend-bar').style.width = (spendCap > 0 ? Math.min(100, Math.round((spent / spendCap) * 100)) : 0) + '%';
      renderActivity(events);
    }
  }

  function renderActivity(events) {
    const list = $('timeline'); if (!list) return;
    if (!events.length) {
      list.innerHTML = '<li class="tl-item" data-sev="info"><span class="tl-dot"></span><span class="tl-time">—</span><span class="tl-type">idle</span><span class="tl-text">No activity yet. Deploy a mission to get started.</span></li>';
      return;
    }
    const sevMap = { info: 'info', warning: 'warn', critical: 'crit' };
    list.innerHTML = events.slice(0, 12).map((e) => {
      const sev = e.type === 'spend' ? 'spend' : (sevMap[e.severity] || 'info');
      return '<li class="tl-item" data-sev="' + sev + '"><span class="tl-dot"></span><span class="tl-time">' + hm(e.createdAt) + '</span><span class="tl-type">' + esc(e.type) + '</span><span class="tl-text">' + esc(e.summary) + '</span></li>';
    }).join('');
  }

  function renderApprovals(waiting) {
    const list = $('approval-list'); if (!list) return;
    const badge = $('approval-count'); const emptyEl = $('approval-empty');
    list.innerHTML = waiting.map((m) =>
      '<div class="approval-item" data-mission="' + m.missionId + '"><div class="ap-body"><div class="ap-title">' + esc(m.title) + '</div><div class="ap-meta">' + m.mode + ' · awaiting approval</div></div>'
      + '<div class="ap-actions"><button class="ap-btn ap-deny" data-act="deny" title="Deny — stop the mission">&#10005;</button><button class="ap-btn ap-ok" data-act="approve" title="Approve — let it run">&#10003;</button></div></div>'
    ).join('');
    if (badge) { badge.textContent = waiting.length; badge.classList.toggle('zero', waiting.length === 0); }
    if (emptyEl) emptyEl.classList.toggle('hidden', waiting.length !== 0);
    list.querySelectorAll('.approval-item .ap-btn').forEach((btn) => btn.addEventListener('click', async () => {
      const item = btn.closest('.approval-item'); const id = item.getAttribute('data-mission');
      const approved = btn.getAttribute('data-act') === 'approve';
      const title = item.querySelector('.ap-title') ? item.querySelector('.ap-title').textContent : 'Mission';
      try { await api('/api/local/missions/' + encodeURIComponent(id) + '/status', { method: 'POST', body: JSON.stringify({ status: approved ? 'running' : 'stopped' }) }); } catch (e) { /* offline */ }
      logEvent('approval', (approved ? 'Approved: ' : 'Denied: ') + title, approved ? 'ok' : 'warn');
      toast(approved ? 'Approved' : 'Denied', title, approved ? 'info' : 'warn');
      refreshOverview();
    }));
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function shortUrl(u) { try { return new URL(u).host.replace(/^www\./, ''); } catch (e) { return u; } }

  // ── Kill switch ──────────────────────────────────────────
  const killBtn = $('kill-switch');
  if (killBtn) {
    killBtn.addEventListener('click', function () {
      state.killed = !state.killed;
      if (state.killed) {
        killBtn.innerHTML = '▶ RESUME';
        killBtn.classList.remove('btn-danger');
        killBtn.classList.add('btn-secondary', 'active');
        setStatus('Agent paused — kill switch active', 'paused');
        setMissionStat('Halted', false);
        logEvent('kill', 'Kill switch engaged — all agent activity halted.', 'crit');
        toast('Kill switch engaged', 'All agent activity halted.', 'danger');
        document.dispatchEvent(new CustomEvent('agent-os:kill', { detail: { killed: true } }));
      } else {
        killBtn.innerHTML = '<span class="kill-ico">█</span> KILL SWITCH';
        killBtn.classList.add('btn-danger');
        killBtn.classList.remove('btn-secondary', 'active');
        setStatus('Ready', 'active');
        setMissionStat(state.mission ? 'Running' : 'Idle', !!state.mission);
        logEvent('kill', 'Kill switch released — agent resumed.', 'ok');
        toast('Resumed', 'Agent activity restored.', 'info');
        document.dispatchEvent(new CustomEvent('agent-os:kill', { detail: { killed: false } }));
      }
    });
  }

  // ── Mission ──────────────────────────────────────────────
  const missionInput = $('mission-prompt');
  if ($('save-mission') && missionInput) {
    $('save-mission').addEventListener('click', function () {
      state.mission = missionInput.value.trim();
      if (!state.mission) { toast('Nothing to deploy', 'Write an objective first.', 'warn'); return; }
      setStatus('Mission deployed', 'active');
      setMissionStat('Running', true);
      if ($('active-mission-empty')) $('active-mission-empty').classList.add('hidden');
      if ($('active-mission-text')) { $('active-mission-text').classList.remove('hidden'); $('active-mission-text').textContent = state.mission; }
      if ($('stat-mission-sub')) $('stat-mission-sub').textContent = 'Deployed ' + nowHM();
      logEvent('mission', 'Mission deployed: ' + state.mission.slice(0, 60) + (state.mission.length > 60 ? '…' : ''), 'ok');
      toast('Mission deployed', 'Agent is now working toward your objective.');
      (async () => {
        try {
          await api('/api/local/missions', { method: 'POST', body: JSON.stringify({
            objective: state.mission, mode: state.role, status: 'running',
            budget: { perCall: state.spendCaps.perCall, daily: state.spendCaps.daily, missionTotal: state.spendCaps.monthly },
          }) });
        } catch (e) {
          MISSIONS.unshift({
            id: 'm-' + (1000 + MISSIONS.length), title: state.mission.slice(0, 42), objective: state.mission,
            mode: state.role, status: 'running', spent: 0, cap: state.spendCaps.daily,
            agents: Object.keys(state.harnesses).filter((h) => state.harnesses[h]).map(cap),
            updated: 'just now', milestones: [], assumptions: [], exitRules: [],
          });
        }
        renderMissions();
        refreshOverview();
      })();
      if ($('mission-creator')) $('mission-creator').classList.add('hidden');
      if (missionInput) missionInput.value = '';
      document.dispatchEvent(new CustomEvent('agent-os:mission', { detail: { mission: state.mission } }));
    });
  }
  if ($('clear-mission') && missionInput) {
    $('clear-mission').addEventListener('click', function () {
      missionInput.value = '';
      state.mission = '';
      setMissionStat('Idle', false);
      if ($('active-mission-empty')) $('active-mission-empty').classList.remove('hidden');
      if ($('active-mission-text')) $('active-mission-text').classList.add('hidden');
      if ($('stat-mission-sub')) $('stat-mission-sub').textContent = 'No mission deployed';
    });
  }

  // ── Role selection ───────────────────────────────────────
  document.querySelectorAll('input[name="operator-role"]').forEach(function (input) {
    input.addEventListener('change', function () {
      state.role = input.value;
      if ($('status-mode')) $('status-mode').textContent = 'MODE: ' + state.role.toUpperCase();
      logEvent('mode', 'Autonomy mode set to ' + cap(state.role) + '.', 'info');
      toast('Autonomy → ' + cap(state.role), MODE_META[state.role].sub);
      document.dispatchEvent(new CustomEvent('agent-os:role', { detail: { role: state.role } }));
    });
  });

  // ── Spend caps ───────────────────────────────────────────
  if ($('save-spend-caps')) {
    $('save-spend-caps').addEventListener('click', function () {
      state.spendCaps.perCall = parseFloat($('spend-per-call') ? $('spend-per-call').value : '1') || 1;
      state.spendCaps.daily = parseFloat($('spend-daily') ? $('spend-daily').value : '25') || 25;
      state.spendCaps.monthly = parseFloat($('spend-monthly') ? $('spend-monthly').value : '200') || 200;
      setStatus('Spend caps applied', 'active');
      logEvent('budget', 'Spend caps updated — daily $' + state.spendCaps.daily + ', monthly $' + state.spendCaps.monthly + '.', 'info');
      toast('Spend caps applied', 'Daily $' + state.spendCaps.daily + ' · monthly $' + state.spendCaps.monthly + '. The agent cannot exceed these.');
      document.dispatchEvent(new CustomEvent('agent-os:spend-caps', { detail: { spendCaps: state.spendCaps } }));
    });
  }

  // ── Strategy skill ───────────────────────────────────────
  const strategyToggle = $('strategy-enabled');
  if (strategyToggle && $('strategy-config')) {
    strategyToggle.addEventListener('change', function () {
      state.strategyEnabled = strategyToggle.checked;
      $('strategy-config').classList.toggle('hidden', !state.strategyEnabled);
      updateSystemToggles();
      toast(state.strategyEnabled ? 'Strategy Skill on' : 'Strategy Skill off',
        state.strategyEnabled ? 'The agent will plan and reroute big goals.' : 'Direct execution only.');
      if (state.strategyEnabled) logEvent('strategy', 'Strategy Skill enabled (' + state.strategyHorizon + ' horizon).', 'info');
      document.dispatchEvent(new CustomEvent('agent-os:strategy', { detail: { enabled: state.strategyEnabled } }));
    });
  }
  if ($('strategy-horizon')) {
    $('strategy-horizon').addEventListener('change', function () {
      state.strategyHorizon = $('strategy-horizon').value;
      document.dispatchEvent(new CustomEvent('agent-os:strategy', { detail: { enabled: state.strategyEnabled, horizon: state.strategyHorizon } }));
    });
  }

  // ── Harness toggles ──────────────────────────────────────
  document.querySelectorAll('.harness-toggle').forEach(function (tgl) {
    const harness = tgl.getAttribute('data-harness');
    if (harness && state.harnesses[harness] !== undefined) tgl.checked = state.harnesses[harness];
    tgl.addEventListener('change', function () {
      if (!harness) return;
      state.harnesses[harness] = tgl.checked;
      logEvent('harness', cap(harness) + ' harness ' + (tgl.checked ? 'online' : 'offline') + '.', 'info');
      toast(cap(harness) + (tgl.checked ? ' online' : ' offline'), tgl.checked ? 'Available as an agent runtime.' : 'Removed from rotation.');
      document.dispatchEvent(new CustomEvent('agent-os:harness', { detail: { harness, enabled: tgl.checked } }));
    });
  });

  // ── Local mode ───────────────────────────────────────────
  if ($('local-mode-enabled')) {
    $('local-mode-enabled').addEventListener('change', function () {
      state.localMode = $('local-mode-enabled').checked;
      updateSystemToggles();
      toast(state.localMode ? 'Local mode on' : 'Local mode off', state.localMode ? 'No cloud login. SQLite + local SMTP + Kubo.' : 'Cloud APIs available.');
      document.dispatchEvent(new CustomEvent('agent-os:local-mode', { detail: { localMode: state.localMode } }));
    });
  }

  // ── OpenTrust actions ────────────────────────────────────
  if ($('ot-registry-url')) {
    $('ot-registry-url').addEventListener('change', function () {
      state.registryUrl = $('ot-registry-url').value.trim();
    });
  }
  function otAction(action, label) {
    document.dispatchEvent(new CustomEvent('agent-os:opentrust', { detail: { action, registryUrl: state.registryUrl } }));
    setStatus('OpenTrust: ' + action + ' started', 'active');
    logEvent('opentrust', label + ' on ' + shortUrl(state.registryUrl) + '.', 'info');
    toast(label, 'Dispatched to ' + shortUrl(state.registryUrl) + '.');
  }
  if ($('browse-marketplace')) $('browse-marketplace').addEventListener('click', () => otAction('browse-marketplace', 'Browsing marketplace'));
  if ($('run-passport-flow')) $('run-passport-flow').addEventListener('click', () => otAction('passport-flow', 'Passport flow started'));
  if ($('post-job')) $('post-job').addEventListener('click', () => otAction('post-job', 'Posting job'));
  if ($('run-review')) $('run-review').addEventListener('click', () => otAction('submit-review', 'Submitting review'));

  // Approvals on the Overview are rendered live by renderApprovals() from
  // missions awaiting approval — see refreshOverview().

  // ── Missions / Decisions / Agents (live, with offline seed fallback) ──
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const STATUS_LABEL = { running: 'running', waiting_approval: 'waiting', blocked: 'blocked', done: 'done', failed: 'failed', stopped: 'stopped', draft: 'draft', idle: 'idle' };

  const MISSIONS = [
    { id: 'm-101', title: 'Marketplace growth', objective: 'Onboard 5 marketplace sellers and validate their passports this week.', mode: 'shopkeeper', status: 'running', spent: 38, cap: 200, agents: ['Claude', 'Hermes'], updated: '12m ago',
      milestones: [['Identify 20 candidate sellers', 'done'], ['Reach out to top 10', 'active'], ['Validate 5 passports', 'todo'], ['Publish listings', 'todo']],
      assumptions: ['Sellers respond to warm intros', 'Passport validation under 10 min each'],
      exitRules: ['Stop if 0 sellers onboarded by day 5', 'Pause if spend exceeds $150'] },
    { id: 'm-102', title: 'Lead outreach', objective: 'Find 50 qualified leads, draft outreach, send from inbox, and track replies.', mode: 'operator', status: 'waiting_approval', spent: 6.2, cap: 50, agents: ['Claude'], updated: '3m ago',
      milestones: [['Import lead list', 'done'], ['Enrich and qualify', 'done'], ['Draft outreach', 'active'], ['Send and track', 'todo']],
      assumptions: ['Leads match the ICP', 'Inbox is warmed'],
      exitRules: ['Stop if bounce rate exceeds 20%'] },
    { id: 'm-103', title: 'Repo + landing page', objective: 'Set up the GitHub repo and ship the first landing page PR.', mode: 'manager', status: 'done', spent: 0, cap: 25, agents: ['Codex'], updated: '2d ago',
      milestones: [['Create repo', 'done'], ['Scaffold Next.js', 'done'], ['Open PR', 'done']], assumptions: [], exitRules: [] },
  ];
  const DECISIONS = [
    { id: 'd-1', mission: 'Lead outreach', trigger: 'assumption_invalidated', time: '10:21', cost: 0, reversible: true, by: 'autonomous',
      title: 'Pivot from cold email to warm intros',
      rationale: '0 of 40 cold emails drew a reply — the assumption "leads respond to cold email" is invalidated. Switching to LinkedIn warm intros through shared connections.',
      alts: [['Keep sending cold email', '0% reply rate after 40 sends'], ['Buy a larger lead list', 'Outside budget and lower intent']] },
    { id: 'd-2', mission: 'Marketplace growth', trigger: 'budget_allocation', time: '09:48', cost: 60, reversible: true, by: 'human',
      title: 'Allocate $60 to Apollo for seller sourcing',
      rationale: 'Need verified contact data for 20 candidate sellers; Apollo is the cheapest option inside the mission budget.',
      alts: [['Source sellers manually', 'Too slow for a one-week milestone']] },
    { id: 'd-3', mission: 'Marketplace growth', trigger: 'strategy_plan', time: '09:42', cost: 0, reversible: true, by: 'autonomous',
      title: 'Onboard sellers before acquiring buyers',
      rationale: 'The marketplace is supply-constrained; adding sellers unlocks buyer value. Front-load supply first.',
      alts: [['Acquire buyers first', 'Nothing to buy yet — they would churn']] },
  ];
  const AGENTS = [
    { id: 'agent-claude-01', harness: 'claude', glyph: '◆', model: 'claude-opus-4-8', status: 'running', task: 'Drafting outreach emails for Lead outreach', mission: 'Lead outreach', tele: 'exact' },
    { id: 'agent-hermes-01', harness: 'hermes', glyph: '▩', model: '—', status: 'idle', task: null, mission: 'Marketplace growth', tele: 'parsed' },
    { id: 'agent-codex-01', harness: 'codex', glyph: '▤', model: 'gpt-5-codex', status: 'stopped', task: null, mission: 'Repo + landing page', tele: 'estimated' },
  ];

  // ── Live data client (falls back to the seeds above when offline) ──
  const SESSION_TOKEN = (function () {
    const m = document.querySelector('meta[name="hbf-session"]');
    const v = m ? m.getAttribute('content') : '';
    return v && v.indexOf('__HBF') === -1 ? v : '';
  })();
  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
    if (SESSION_TOKEN) headers['x-hbf-local-session'] = SESSION_TOKEN;
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    if (!res.ok) throw new Error('http ' + res.status);
    return res.json();
  }
  const HARNESS_GLYPH = { hermes: '▩', openclaw: '▣', codex: '▤', claude: '◆' };
  function relTime(iso) {
    try { const ms = Date.now() - Date.parse(iso); const s = Math.max(1, Math.round(ms / 1000));
      if (s < 60) return s + 's ago'; const m = Math.round(s / 60); if (m < 60) return m + 'm ago';
      const h = Math.round(m / 60); if (h < 24) return h + 'h ago'; return Math.round(h / 24) + 'd ago';
    } catch (e) { return ''; }
  }
  function hm(iso) { try { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); } catch (e) { return ''; } }
  function capOf(b) { return (b && (b.missionTotal || b.daily)) || 0; }
  function mapMission(m, agents) {
    return { id: m.missionId, title: m.title, objective: m.objective, mode: m.mode, status: m.status, spent: 0, cap: capOf(m.budget),
      agents: (agents || []).filter((a) => a.missionId === m.missionId).map((a) => cap(a.harness)), updated: relTime(m.updatedAt), _live: true };
  }
  function mapDetail(d) {
    const m = d.mission; const strat = (d.strategies && d.strategies[0]) || null;
    const spent = (d.events || []).filter((e) => e.type === 'spend').reduce((t, e) => t + (Number(e.data && e.data.amount) || 0), 0);
    return { id: m.missionId, title: m.title, objective: m.objective, mode: m.mode, status: m.status,
      spent: Math.round(spent * 100) / 100, cap: capOf(m.budget), budget: m.budget || {},
      milestones: strat ? strat.milestones.map((t) => [t, 'todo']) : [],
      assumptions: strat ? strat.assumptions : [], exitRules: strat ? strat.exitRules : [],
      agents: (d.agents || []).map((a) => cap(a.harness)), decisions: (d.decisions || []).map((x) => ({ title: x.title })), _live: true };
  }
  function mapDecision(d) {
    return { id: d.decisionId, mission: d.missionTitle || d.missionId, trigger: d.trigger, time: hm(d.createdAt),
      cost: d.cost, reversible: d.reversible, by: d.approvedBy, title: d.title, rationale: d.rationale,
      alts: (d.alternatives || []).map((a) => [a.option, a.rejectedBecause]) };
  }
  function mapAgent(a) {
    return { id: a.agentId, harness: a.harness, glyph: HARNESS_GLYPH[a.harness] || '◆', model: a.model, status: a.status,
      task: a.currentTaskId, mission: a.missionTitle || a.missionId, tele: a.telemetryQuality };
  }
  let liveMissions = null;

  async function renderMissions() {
    const list = $('mission-list'); if (!list) return;
    let data;
    try {
      const md = await api('/api/local/missions');
      let ags = []; try { ags = (await api('/api/local/agents')).agents || []; } catch (e) { /* ignore */ }
      liveMissions = (md.missions || []).map((m) => mapMission(m, ags));
      data = liveMissions;
    } catch (e) { liveMissions = null; data = MISSIONS; }
    if ($('missions-count')) $('missions-count').textContent = data.length;
    if ($('missions-running')) $('missions-running').textContent = data.filter((m) => m.status === 'running').length;
    list.innerHTML = data.map(missionCardHtml).join('');
    list.querySelectorAll('.mission-card').forEach((c) => c.addEventListener('click', () => openMission(c.getAttribute('data-mission'))));
  }
  function missionCardHtml(m) {
    const pct = m.cap ? Math.min(100, Math.round((m.spent / m.cap) * 100)) : 0;
    const warn = pct >= 75 ? 'warn' : '';
    return '<div class="mission-card" data-mission="' + m.id + '">'
      + '<div class="mc-top"><span class="mc-title">' + esc(m.title) + '</span><span class="mc-mode">' + m.mode + '</span>'
      + '<span class="pill pill-' + m.status + '">' + (STATUS_LABEL[m.status] || m.status) + '</span></div>'
      + '<div class="mc-obj">' + esc(m.objective) + '</div><div class="mc-foot">'
      + '<div class="mc-stat"><span class="k">Budget</span><span class="v">$' + m.spent + ' / $' + m.cap + '</span>'
      + '<span class="mc-budget-bar"><span class="' + warn + '" style="width:' + pct + '%"></span></span></div>'
      + '<div class="mc-stat"><span class="k">Agents</span><span class="v">' + esc(m.agents.join(', ') || '—') + '</span></div>'
      + '<div class="mc-stat"><span class="k">Updated</span><span class="v">' + esc(m.updated) + '</span></div>'
      + '</div></div>';
  }
  async function openMission(id) {
    let m = null;
    try { m = mapDetail(await api('/api/local/missions/' + encodeURIComponent(id) + '/detail')); }
    catch (e) { m = (liveMissions || MISSIONS).find((x) => x.id === id) || MISSIONS.find((x) => x.id === id); }
    if (!m) return;
    renderMissionDetail(m);
    setView('mission-detail');
  }
  function renderMissionDetail(m) {
    const el = $('mission-detail'); if (!el) return;
    const pct = m.cap ? Math.min(100, Math.round((m.spent / m.cap) * 100)) : 0;
    const milestones = m.milestones.map((p) => '<div class="milestone ' + p[1] + '"><span class="ms-box"></span><span class="ms-text">' + esc(p[0]) + '</span></div>').join('') || '<div class="chip-row">No milestones.</div>';
    const assumptions = m.assumptions.length ? m.assumptions.map((a) => '<div class="chip-row">' + esc(a) + '</div>').join('') : '<div class="chip-row">None recorded.</div>';
    const exits = m.exitRules.length ? m.exitRules.map((a) => '<div class="chip-row exit">' + esc(a) + '</div>').join('') : '<div class="chip-row">None.</div>';
    const decs = m.decisions || DECISIONS.filter((d) => d.mission === m.title);
    const decHtml = decs.length ? decs.map((d) => '<div class="milestone"><span class="ms-box"></span><span class="ms-text">' + esc(d.title) + '</span></div>').join('') : '<div class="chip-row">No decisions yet.</div>';
    const bg = m.budget || {};
    const bPerCall = bg.perCall != null ? bg.perCall : 0;
    const bDaily = bg.daily != null ? bg.daily : (m.cap || 0);
    const bTotal = bg.missionTotal != null ? bg.missionTotal : (m.cap || 0);
    const modeOpts = ['manager', 'operator', 'shopkeeper', 'founder']
      .map((v) => '<option value="' + v + '"' + (v === m.mode ? ' selected' : '') + '>' + cap(v) + '</option>').join('');
    el.innerHTML =
      '<div class="md-head"><h2 class="md-title">' + esc(m.title) + '</h2><span class="mc-mode">' + m.mode + '</span><span class="pill pill-' + m.status + '">' + (STATUS_LABEL[m.status] || m.status) + '</span></div>'
      + '<div class="md-obj">' + esc(m.objective) + '</div>'
      + '<div class="md-controls">'
      + '<button class="btn btn-secondary btn-sm" data-mc="pause">' + (m.status === 'running' ? 'Pause' : 'Resume') + '</button>'
      + '<button class="btn btn-secondary btn-sm" data-mc="stop">Stop</button>'
      + '<button class="btn btn-secondary btn-sm" id="md-edit-btn">Edit</button>'
      + '<span style="flex:1"></span>'
      + '<button class="btn btn-danger btn-sm" id="md-kill"><span class="kill-ico">&#9608;</span> Kill mission</button></div>'
      + '<div class="md-edit hidden" id="md-edit">'
      + '<p class="md-section-title">Edit mission</p>'
      + '<label class="ed-label" for="ed-objective">Objective</label>'
      + '<textarea class="ed-input" id="ed-objective" rows="3">' + esc(m.objective) + '</textarea>'
      + '<label class="ed-label" for="ed-mode">Autonomy mode</label>'
      + '<select class="ed-input ed-select" id="ed-mode">' + modeOpts + '</select>'
      + '<label class="ed-label">Spend caps (USDC)</label>'
      + '<div class="ed-caps">'
      + '<div class="ed-cap"><span>Per-call</span><input type="number" min="0" step="0.01" id="ed-percall" value="' + bPerCall + '"></div>'
      + '<div class="ed-cap"><span>Daily</span><input type="number" min="0" step="1" id="ed-daily" value="' + bDaily + '"></div>'
      + '<div class="ed-cap"><span>Mission total</span><input type="number" min="0" step="10" id="ed-total" value="' + bTotal + '"></div>'
      + '</div>'
      + '<div class="ed-actions"><button class="btn btn-primary btn-sm" id="ed-save">Save changes</button><button class="btn btn-secondary btn-sm" id="ed-cancel">Cancel</button></div>'
      + '</div>'
      + '<div class="md-grid"><div class="md-main">'
      + '<div class="panel"><p class="md-section-title">Strategy plan · milestones</p>' + milestones + '</div>'
      + '<div class="panel"><p class="md-section-title">Decisions on this mission</p>' + decHtml + '</div></div>'
      + '<div class="md-side">'
      + '<div class="panel"><p class="md-section-title">Spend</p><div class="stat-value" style="font-size:1.2rem">$' + m.spent + ' <span class="stat-of">/ $' + m.cap + '</span></div><div class="meter-bar"><span style="width:' + pct + '%"></span></div>'
      + '<div class="ed-caps-read">per-call $' + bPerCall + ' · daily $' + bDaily + ' · total $' + bTotal + '</div></div>'
      + '<div class="panel"><p class="md-section-title">Assumptions</p><div class="chip-list">' + assumptions + '</div></div>'
      + '<div class="panel"><p class="md-section-title">Exit rules</p><div class="chip-list">' + exits + '</div></div>'
      + '<div class="panel"><p class="md-section-title">Agents</p><div class="chip-list">' + (m.agents.map((a) => '<div class="chip-row">' + esc(a) + '</div>').join('') || '<div class="chip-row">None.</div>') + '</div></div>'
      + '</div></div>';

    // Pause / Stop
    el.querySelectorAll('[data-mc]').forEach((b) => b.addEventListener('click', async () => {
      const act = b.getAttribute('data-mc');
      const next = act === 'stop' ? 'stopped' : (m.status === 'running' ? 'stopped' : 'running');
      const note = act === 'stop' ? 'Mission stopped' : (next === 'running' ? 'Mission resumed' : 'Mission paused');
      if (m._live) {
        try {
          await api('/api/local/missions/' + encodeURIComponent(m.id) + '/status', { method: 'POST', body: JSON.stringify({ status: next }) });
          toast(note, m.title, act === 'stop' ? 'danger' : undefined);
          logEvent('mission', m.title + ' → ' + next + '.', next === 'stopped' ? 'warn' : 'ok');
          openMission(m.id);
          return;
        } catch (e) { /* fall through to optimistic */ }
      }
      m.status = next;
      toast(note, m.title, act === 'stop' ? 'danger' : undefined);
      logEvent('mission', m.title + ' → ' + m.status + '.', m.status === 'stopped' ? 'warn' : 'ok');
      renderMissionDetail(m);
    }));

    // Edit toggle / cancel
    if ($('md-edit-btn')) $('md-edit-btn').addEventListener('click', () => {
      const p = $('md-edit'); if (p) { p.classList.toggle('hidden'); if (!p.classList.contains('hidden')) p.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    });
    if ($('ed-cancel')) $('ed-cancel').addEventListener('click', () => { const p = $('md-edit'); if (p) p.classList.add('hidden'); });

    // Save edits
    if ($('ed-save')) $('ed-save').addEventListener('click', async () => {
      const objective = $('ed-objective').value.trim();
      const mode = $('ed-mode').value;
      const perCall = parseFloat($('ed-percall').value) || 0;
      const daily = parseFloat($('ed-daily').value) || 0;
      const missionTotal = parseFloat($('ed-total').value) || 0;
      if (!objective) { toast('Objective required', 'Give the mission an objective.', 'warn'); return; }
      const patch = { objective, mode, budget: { perCall, daily, missionTotal } };
      if (m._live) {
        try {
          await api('/api/local/missions/' + encodeURIComponent(m.id), { method: 'PATCH', body: JSON.stringify(patch) });
          toast('Mission updated', m.title);
          logEvent('mission', m.title + ' settings updated.', 'info');
          openMission(m.id);
          return;
        } catch (e) { /* fall through to optimistic */ }
      }
      Object.assign(m, { objective, mode, cap: missionTotal || daily, budget: { perCall, daily, missionTotal } });
      const seed = MISSIONS.find((x) => x.id === m.id); if (seed) Object.assign(seed, { objective, mode, cap: m.cap });
      toast('Mission updated', m.title);
      renderMissionDetail(m);
    });

    // Kill (delete) mission
    if ($('md-kill')) $('md-kill').addEventListener('click', async () => {
      if (!window.confirm('Kill mission "' + m.title + '"? This permanently deletes it and its history.')) return;
      if (m._live) {
        try {
          await api('/api/local/missions/' + encodeURIComponent(m.id), { method: 'DELETE' });
          toast('Mission killed', m.title, 'danger');
          logEvent('mission', m.title + ' killed (deleted).', 'crit');
          setView('missions');
          refreshOverview();
          return;
        } catch (e) { /* fall through to optimistic */ }
      }
      const i = MISSIONS.findIndex((x) => x.id === m.id); if (i >= 0) MISSIONS.splice(i, 1);
      toast('Mission killed', m.title, 'danger');
      setView('missions');
    });
  }

  async function renderDecisions() {
    const list = $('decision-list'); if (!list) return;
    let data;
    try { data = ((await api('/api/local/decisions')).decisions || []).map(mapDecision); }
    catch (e) { data = DECISIONS; }
    list.innerHTML = data.length ? data.map(decisionCardHtml).join('') : '<div class="view-head-meta">No decisions recorded yet.</div>';
  }
  function decisionCardHtml(d) {
    const alts = d.alts.map((p) => '<div class="dc-alt"><span class="x">✕</span> <span class="opt">' + esc(p[0]) + '</span> — ' + esc(p[1]) + '</div>').join('');
    return '<div class="decision-card"><div class="dc-top"><span class="dc-title">' + esc(d.title) + '</span>'
      + '<span class="dc-trigger">' + d.trigger.replace(/_/g, ' ') + '</span><span class="dc-time">' + d.time + '</span></div>'
      + '<div class="dc-rationale">' + esc(d.rationale) + '</div>' + (alts ? '<div class="dc-alts">' + alts + '</div>' : '')
      + '<div class="dc-meta"><span class="dc-mission">' + esc(d.mission) + '</span><span><b>cost</b> $' + d.cost + '</span>'
      + '<span><b>reversible</b> ' + (d.reversible ? 'yes' : 'no') + '</span><span class="by-' + d.by + '"><b>by</b> ' + d.by + '</span></div></div>';
  }

  async function renderAgents() {
    const list = $('agent-list'); if (!list) return;
    let data;
    try { data = ((await api('/api/local/agents')).agents || []).map(mapAgent); }
    catch (e) { data = AGENTS; }
    if ($('agents-count')) $('agents-count').textContent = data.length;
    list.innerHTML = data.length ? data.map(agentCardHtml).join('') : '<div class="view-head-meta">No agent instances yet.</div>';
  }
  function agentCardHtml(a) {
    return '<div class="agent-card"><div class="ag-avatar">' + a.glyph + '</div>'
      + '<div class="ag-main"><div class="ag-name">' + esc(a.id) + '</div><div class="ag-sub">' + a.harness + ' · ' + esc(a.model) + '</div></div>'
      + '<div class="ag-task">' + (a.task ? esc(a.task) : '<span class="none">no active task</span>') + '</div>'
      + '<div class="ag-right"><span class="pill pill-' + a.status + '">' + (STATUS_LABEL[a.status] || a.status) + '</span>'
      + '<span class="ag-tele ' + a.tele + '">telemetry: ' + a.tele + '</span><span class="ag-sub">' + esc(a.mission || 'unassigned') + '</span></div></div>';
  }

  if ($('new-mission-btn')) {
    $('new-mission-btn').addEventListener('click', () => {
      const c = $('mission-creator');
      if (c) { c.classList.toggle('hidden'); if (!c.classList.contains('hidden')) { c.scrollIntoView({ behavior: 'smooth' }); setTimeout(() => missionInput && missionInput.focus(), 200); } }
    });
  }
  if ($('detail-back')) $('detail-back').addEventListener('click', () => setView('missions'));

  // ── Quick actions ────────────────────────────────────────
  function gotoCreator() {
    setView('missions');
    const c = $('mission-creator'); if (c) c.classList.remove('hidden');
    setTimeout(() => missionInput && missionInput.focus(), 90);
  }
  if ($('qa-deploy')) $('qa-deploy').addEventListener('click', gotoCreator);
  if ($('qa-go-mission')) $('qa-go-mission').addEventListener('click', gotoCreator);

  // ── Public API ───────────────────────────────────────────
  window.__agentOs = {
    getState: function () { return Object.assign({}, state); },
    setState: function (patch) { Object.assign(state, patch); },
    setView: setView,
    toast: toast,
  };

  // ── Init ─────────────────────────────────────────────────
  const initView = (location.hash || '').replace('#', '');
  setView(VIEWS[initView] ? initView : 'overview');
  setStatus('Ready', 'active');
})();
