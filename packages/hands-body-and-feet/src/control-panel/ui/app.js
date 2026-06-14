/**
 * Agent OS Control Panel — minimal vanilla JS
 * No framework, no build step required.
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
    harnesses: {
      hermes: false,
      openclaw: false,
      codex: false,
      claude: true,
    },
    registryUrl: 'https://opentrust.dev/api/v1',
  };

  // ── Kill switch ──────────────────────────────────────────
  const killBtn = document.getElementById('kill-switch');
  const statusText = document.getElementById('status-text');
  const statusDot = document.getElementById('status-dot');

  function setStatus(text, dotClass) {
    if (statusText) statusText.textContent = text;
    if (statusDot) {
      statusDot.className = 'status-dot';
      if (dotClass) statusDot.classList.add(dotClass);
    }
  }

  if (killBtn) {
    killBtn.addEventListener('click', function () {
      state.killed = !state.killed;
      if (state.killed) {
        killBtn.textContent = '▶ Resume';
        killBtn.classList.remove('btn-danger');
        killBtn.classList.add('btn-secondary', 'active');
        setStatus('Agent paused — kill switch active', 'paused');
        document.dispatchEvent(new CustomEvent('agent-os:kill', { detail: { killed: true } }));
      } else {
        killBtn.innerHTML = '▐▐ Kill Switch';
        killBtn.classList.add('btn-danger');
        killBtn.classList.remove('btn-secondary', 'active');
        setStatus('Ready', 'active');
        document.dispatchEvent(new CustomEvent('agent-os:kill', { detail: { killed: false } }));
      }
    });
  }

  // ── Mission ──────────────────────────────────────────────
  const missionInput = document.getElementById('mission-prompt');
  const saveMissionBtn = document.getElementById('save-mission');
  const clearMissionBtn = document.getElementById('clear-mission');

  if (saveMissionBtn && missionInput) {
    saveMissionBtn.addEventListener('click', function () {
      state.mission = missionInput.value.trim();
      setStatus('Mission saved', 'active');
      document.dispatchEvent(new CustomEvent('agent-os:mission', { detail: { mission: state.mission } }));
    });
  }

  if (clearMissionBtn && missionInput) {
    clearMissionBtn.addEventListener('click', function () {
      missionInput.value = '';
      state.mission = '';
    });
  }

  // ── Role selection ───────────────────────────────────────
  const roleInputs = document.querySelectorAll('input[name="operator-role"]');
  roleInputs.forEach(function (input) {
    input.addEventListener('change', function () {
      state.role = input.value;
      document.dispatchEvent(new CustomEvent('agent-os:role', { detail: { role: state.role } }));
    });
  });

  // ── Spend caps ───────────────────────────────────────────
  const saveSpendBtn = document.getElementById('save-spend-caps');
  const spendPerCall = document.getElementById('spend-per-call');
  const spendDaily = document.getElementById('spend-daily');
  const spendMonthly = document.getElementById('spend-monthly');

  if (saveSpendBtn) {
    saveSpendBtn.addEventListener('click', function () {
      state.spendCaps.perCall = parseFloat(spendPerCall ? spendPerCall.value : '1') || 1;
      state.spendCaps.daily = parseFloat(spendDaily ? spendDaily.value : '25') || 25;
      state.spendCaps.monthly = parseFloat(spendMonthly ? spendMonthly.value : '200') || 200;
      setStatus('Spend caps applied', 'active');
      document.dispatchEvent(new CustomEvent('agent-os:spend-caps', { detail: { spendCaps: state.spendCaps } }));
    });
  }

  // ── Strategy skill ───────────────────────────────────────
  const strategyToggle = document.getElementById('strategy-enabled');
  const strategyConfig = document.getElementById('strategy-config');
  const strategyHorizon = document.getElementById('strategy-horizon');

  if (strategyToggle && strategyConfig) {
    strategyToggle.addEventListener('change', function () {
      state.strategyEnabled = strategyToggle.checked;
      strategyConfig.classList.toggle('hidden', !state.strategyEnabled);
      document.dispatchEvent(new CustomEvent('agent-os:strategy', { detail: { enabled: state.strategyEnabled } }));
    });
  }

  if (strategyHorizon) {
    strategyHorizon.addEventListener('change', function () {
      state.strategyHorizon = strategyHorizon.value;
      document.dispatchEvent(new CustomEvent('agent-os:strategy', {
        detail: { enabled: state.strategyEnabled, horizon: state.strategyHorizon },
      }));
    });
  }

  // ── Harness toggles ──────────────────────────────────────
  const harnessToggles = document.querySelectorAll('.harness-toggle');
  harnessToggles.forEach(function (toggle) {
    const harness = toggle.getAttribute('data-harness');
    if (harness && state.harnesses[harness] !== undefined) {
      toggle.checked = state.harnesses[harness];
    }
    toggle.addEventListener('change', function () {
      if (harness) {
        state.harnesses[harness] = toggle.checked;
        document.dispatchEvent(new CustomEvent('agent-os:harness', {
          detail: { harness, enabled: toggle.checked },
        }));
      }
    });
  });

  // ── Local mode ───────────────────────────────────────────
  const localModeToggle = document.getElementById('local-mode-enabled');

  if (localModeToggle) {
    localModeToggle.addEventListener('change', function () {
      state.localMode = localModeToggle.checked;
      document.dispatchEvent(new CustomEvent('agent-os:local-mode', { detail: { localMode: state.localMode } }));
    });
  }

  // ── OpenTrust buttons ────────────────────────────────────
  const browseBtn = document.getElementById('browse-marketplace');
  const passportBtn = document.getElementById('run-passport-flow');
  const jobBtn = document.getElementById('post-job');
  const reviewBtn = document.getElementById('run-review');
  const registryInput = document.getElementById('ot-registry-url');

  if (registryInput) {
    registryInput.addEventListener('change', function () {
      state.registryUrl = registryInput.value.trim();
    });
  }

  function dispatchOtAction(action) {
    document.dispatchEvent(new CustomEvent('agent-os:opentrust', {
      detail: { action, registryUrl: state.registryUrl },
    }));
    setStatus('OpenTrust: ' + action + ' started', 'active');
  }

  if (browseBtn) browseBtn.addEventListener('click', function () { dispatchOtAction('browse-marketplace'); });
  if (passportBtn) passportBtn.addEventListener('click', function () { dispatchOtAction('passport-flow'); });
  if (jobBtn) jobBtn.addEventListener('click', function () { dispatchOtAction('post-job'); });
  if (reviewBtn) reviewBtn.addEventListener('click', function () { dispatchOtAction('submit-review'); });

  // ── Public API (accessible from tests / parent frames) ───
  window.__agentOs = {
    getState: function () { return Object.assign({}, state); },
    setState: function (patch) { Object.assign(state, patch); },
  };

  // ── Init ─────────────────────────────────────────────────
  setStatus('Ready', 'active');
})();
