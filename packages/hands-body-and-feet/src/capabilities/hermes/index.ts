// packages/hands-body-and-feet/src/capabilities/hermes/index.ts
// Auto-installs the HBF bus platform adapter into a local Hermes install.
// Supports Windows native, WSL, and macOS.

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { enforceTrust } from '../../trust.js';
import type { PassportClaims, ToolDefinition } from '../../types.js';

const HERMES_SETUP_TOOL: ToolDefinition  = { name: 'hermes_setup',  minTrustLevel: 3 };
const HERMES_STATUS_TOOL: ToolDefinition = { name: 'hermes_status', minTrustLevel: 2 };

export const HERMES_TOOLS = {
  hermes_setup:  HERMES_SETUP_TOOL,
  hermes_status: HERMES_STATUS_TOOL,
} as const;

// Embedded hbf_bus.py content — written to gateway/platforms/ on setup
const HBF_BUS_PY: string = "\"\"\"\nHBF (hands-body-and-feet) bus platform adapter.\n\nPolls the local SQLite bus at ~/.hands-and-feet/data.db for messages\naddressed to this agent and routes them through the Hermes agent pipeline.\nReplies are written back to the bus as messages to the sender's agent_id.\n\nEnable via .env:\n    HBF_BUS_ENABLED=true          # default: true\n    HBF_AGENT_ID=hermes           # default: \"hermes\"\n    HBF_POLL_INTERVAL=2.0         # seconds between polls (default: 2)\n    HBF_BUS_DB_PATH=...           # override db path (default: ~/.hands-and-feet/data.db)\n\"\"\"\n\nfrom __future__ import annotations\n\nimport asyncio\nimport json\nimport logging\nimport os\nimport sqlite3\nfrom pathlib import Path\nfrom typing import Any, Dict, Optional\n\nfrom gateway.config import Platform, PlatformConfig\nfrom gateway.platforms.base import (\n    BasePlatformAdapter,\n    MessageEvent,\n    MessageType,\n    SendResult,\n)\nfrom gateway.session import SessionSource\n\nlogger = logging.getLogger(__name__)\n\nDEFAULT_AGENT_ID = \"hermes\"\nDEFAULT_POLL_INTERVAL = 2.0\n_DEFAULT_DB_PATH = Path.home() / \".hands-and-feet\" / \"data.db\"\n\n\ndef _get_db_path() -> Path:\n    raw = os.getenv(\"HBF_BUS_DB_PATH\", \"\").strip()\n    return Path(raw) if raw else _DEFAULT_DB_PATH\n\n\ndef check_hbf_bus_requirements() -> bool:\n    return True  # stdlib sqlite3 only\n\n\nclass HBFBusAdapter(BasePlatformAdapter):\n    \"\"\"Gateway adapter that bridges the HBF message bus to Hermes.\"\"\"\n\n    def __init__(self, config: PlatformConfig):\n        super().__init__(config, Platform.HBF_BUS)\n        extra = config.extra or {}\n        self._agent_id: str = str(\n            extra.get(\"agent_id\") or os.getenv(\"HBF_AGENT_ID\", DEFAULT_AGENT_ID)\n        ).strip() or DEFAULT_AGENT_ID\n        self._poll_interval: float = float(\n            extra.get(\"poll_interval\") or os.getenv(\"HBF_POLL_INTERVAL\", DEFAULT_POLL_INTERVAL)\n        )\n        self._db_path: Path = _get_db_path()\n        self._poll_task: Optional[asyncio.Task] = None\n\n    @property\n    def name(self) -> str:\n        return \"HFB Bus\"\n\n    # ------------------------------------------------------------------\n    # Lifecycle\n    # ------------------------------------------------------------------\n\n    async def connect(self) -> bool:\n        if not self._db_path.exists():\n            logger.warning(\n                \"[hfb_bus] Database not found at %s \u2014 HBF may not be initialized yet. \"\n                \"Will retry on each poll.\",\n                self._db_path,\n            )\n        logger.info(\n            \"[hfb_bus] Starting bus poller: agent_id=%s  db=%s  interval=%.1fs\",\n            self._agent_id,\n            self._db_path,\n            self._poll_interval,\n        )\n        self._running = True\n        self._poll_task = asyncio.create_task(self._poll_loop(), name=\"hfb_bus_poll\")\n        return True\n\n    async def disconnect(self) -> None:\n        self._running = False\n        if self._poll_task:\n            self._poll_task.cancel()\n            try:\n                await self._poll_task\n            except asyncio.CancelledError:\n                pass\n            self._poll_task = None\n        logger.info(\"[hfb_bus] Disconnected\")\n\n    # ------------------------------------------------------------------\n    # Polling loop\n    # ------------------------------------------------------------------\n\n    async def _poll_loop(self) -> None:\n        while self._running:\n            try:\n                messages = await asyncio.get_event_loop().run_in_executor(\n                    None, self._claim_messages\n                )\n                for msg in messages:\n                    task = asyncio.create_task(self._dispatch(msg))\n                    self._background_tasks.add(task)\n                    task.add_done_callback(self._background_tasks.discard)\n            except Exception:\n                logger.debug(\"[hfb_bus] Poll error\", exc_info=True)\n            await asyncio.sleep(self._poll_interval)\n\n    def _claim_messages(self) -> list[dict]:\n        \"\"\"Atomically fetch and claim unclaimed messages for this agent.\"\"\"\n        if not self._db_path.exists():\n            return []\n        try:\n            conn = sqlite3.connect(str(self._db_path), timeout=5)\n            conn.row_factory = sqlite3.Row\n            try:\n                with conn:\n                    rows = conn.execute(\n                        \"SELECT id, from_agent, payload, created_at \"\n                        \"FROM bus_messages \"\n                        \"WHERE to_agent = ? AND claimed_at IS NULL \"\n                        \"ORDER BY id ASC\",\n                        (self._agent_id,),\n                    ).fetchall()\n                    if rows:\n                        ids = [r[\"id\"] for r in rows]\n                        conn.execute(\n                            \"UPDATE bus_messages SET claimed_at = datetime('now') \"\n                            f\"WHERE id IN ({','.join('?' * len(ids))})\",\n                            ids,\n                        )\n                return [dict(r) for r in rows]\n            finally:\n                conn.close()\n        except Exception:\n            logger.debug(\"[hfb_bus] DB claim error\", exc_info=True)\n            return []\n\n    # ------------------------------------------------------------------\n    # Dispatch & response\n    # ------------------------------------------------------------------\n\n    async def _dispatch(self, msg: dict) -> None:\n        if self._message_handler is None:\n            logger.debug(\"[hfb_bus] No message handler set, dropping msg id=%s\", msg.get(\"id\"))\n            return\n\n        from_agent = (msg.get(\"from_agent\") or \"unknown\").strip()\n\n        # Parse payload\n        raw_payload = msg.get(\"payload\") or \"{}\"\n        if isinstance(raw_payload, str):\n            try:\n                payload = json.loads(raw_payload)\n            except (json.JSONDecodeError, ValueError):\n                payload = {\"text\": raw_payload}\n        else:\n            payload = raw_payload if isinstance(raw_payload, dict) else {\"text\": str(raw_payload)}\n\n        text = (\n            payload.get(\"text\")\n            or payload.get(\"content\")\n            or payload.get(\"message\")\n            or json.dumps(payload)\n        )\n\n        source = SessionSource(\n            platform=Platform.HBF_BUS,\n            chat_id=from_agent,\n            chat_type=\"dm\",\n            user_id=from_agent,\n            user_name=from_agent,\n            chat_name=f\"hfb:{from_agent}\",\n        )\n        event = MessageEvent(\n            text=str(text),\n            source=source,\n            message_type=MessageType.TEXT,\n            internal=True,\n        )\n\n        logger.info(\"[hfb_bus] Received message from=%s: %.120s\", from_agent, text)\n\n        try:\n            reply = await self._message_handler(event)\n            if reply:\n                await asyncio.get_event_loop().run_in_executor(\n                    None,\n                    self._write_reply,\n                    from_agent,\n                    str(reply),\n                )\n        except Exception:\n            logger.exception(\"[hfb_bus] Error dispatching message from %s\", from_agent)\n\n    def _write_reply(self, to_agent: str, text: str) -> None:\n        if not self._db_path.exists():\n            logger.warning(\"[hfb_bus] Cannot send reply \u2014 db not found\")\n            return\n        try:\n            conn = sqlite3.connect(str(self._db_path), timeout=5)\n            try:\n                with conn:\n                    conn.execute(\n                        \"INSERT INTO bus_messages (to_agent, from_agent, payload, created_at) \"\n                        \"VALUES (?, ?, ?, datetime('now'))\",\n                        (\n                            to_agent,\n                            self._agent_id,\n                            json.dumps({\"text\": text, \"from\": self._agent_id}),\n                        ),\n                    )\n            finally:\n                conn.close()\n            logger.info(\"[hfb_bus] Sent reply to=%s: %.80s\", to_agent, text)\n        except Exception:\n            logger.warning(\"[hfb_bus] Failed to write reply to %s\", to_agent, exc_info=True)\n\n    # ------------------------------------------------------------------\n    # BasePlatformAdapter abstract methods\n    # ------------------------------------------------------------------\n\n    async def send(\n        self,\n        chat_id: str,\n        content: str,\n        reply_to: Optional[str] = None,\n        metadata: Optional[Dict[str, Any]] = None,\n    ) -> SendResult:\n        try:\n            await asyncio.get_event_loop().run_in_executor(\n                None, self._write_reply, chat_id, content\n            )\n            return SendResult(success=True)\n        except Exception as exc:\n            return SendResult(success=False, error=str(exc))\n\n    async def get_chat_info(self, chat_id: str) -> Dict[str, Any]:\n        return {\"name\": f\"hfb:{chat_id}\", \"type\": \"dm\"}\n";

// Idempotent Python patcher for config.py + run.py — prints JSON result map
const PATCH_PY: string = "import sys, os, pathlib, json\nagent_dir = pathlib.Path(sys.argv[1])\nconfig_py = agent_dir / \"gateway\" / \"config.py\"\nrun_py    = agent_dir / \"gateway\" / \"run.py\"\nresults   = {}\n\ntxt = config_py.read_text(encoding=\"utf-8\")\nchanged = False\n\nif 'HBF_BUS = \"hbf_bus\"' not in txt:\n    if 'YUANBAO = \"yuanbao\"' in txt:\n        txt = txt.replace('    YUANBAO = \"yuanbao\"', '    YUANBAO = \"yuanbao\"\\n    HBF_BUS = \"hbf_bus\"', 1)\n        changed = True\n    else:\n        results[\"config_enum\"] = \"WARN: add HBF_BUS = \\\"hbf_bus\\\" to Platform enum after YUANBAO manually\"\nelse:\n    results[\"config_enum\"] = \"already present\"\n\nif \"Platform.HBF_BUS: lambda cfg: True\" not in txt:\n    if \"Platform.YUANBAO: lambda cfg: bool(\" in txt:\n        txt = txt.replace(\"Platform.YUANBAO: lambda cfg: bool(\", \"Platform.HBF_BUS: lambda cfg: True,\\n    Platform.YUANBAO: lambda cfg: bool(\", 1)\n        changed = True\n    else:\n        results[\"config_ready\"] = \"WARN: add Platform.HBF_BUS: lambda cfg: True manually\"\nelse:\n    results[\"config_ready\"] = \"already present\"\n\nold_api = 'os.getenv(\"API_SERVER_ENABLED\", \"\").lower() in {\"true\", \"1\", \"yes\"}'\nnew_api = 'os.getenv(\"API_SERVER_ENABLED\", \"true\").lower() not in {\"false\", \"0\", \"no\"}'\nif old_api in txt:\n    txt = txt.replace(old_api, new_api, 1); changed = True\n    results[\"config_api_server\"] = \"patched to always-on\"\nelif new_api in txt:\n    results[\"config_api_server\"] = \"already always-on\"\nelse:\n    results[\"config_api_server\"] = \"WARN: API_SERVER_ENABLED line not found\"\n\nif 'hfb_bus_enabled = os.getenv(\"HBF_BUS_ENABLED\"' not in txt:\n    marker = \"    # Webhook platform\\n    webhook_enabled\"\n    if marker in txt:\n        block = (\n            \"    # HBF Bus platform\\n\"\n            '    hfb_bus_enabled = os.getenv(\"HBF_BUS_ENABLED\", \"true\").lower() not in {\"false\", \"0\", \"no\"}\\n'\n            \"    if hfb_bus_enabled:\\n\"\n            \"        if Platform.HBF_BUS not in config.platforms:\\n\"\n            \"            config.platforms[Platform.HBF_BUS] = PlatformConfig()\\n\"\n            \"        config.platforms[Platform.HBF_BUS].enabled = True\\n\"\n            '        hfb_agent_id = os.getenv(\"HBF_AGENT_ID\", \"\")\\n'\n            \"        if hfb_agent_id:\\n\"\n            '            config.platforms[Platform.HBF_BUS].extra[\"agent_id\"] = hfb_agent_id\\n'\n            '        hfb_poll_interval = os.getenv(\"HBF_POLL_INTERVAL\", \"\")\\n'\n            \"        if hfb_poll_interval:\\n\"\n            '            config.platforms[Platform.HBF_BUS].extra[\"poll_interval\"] = hfb_poll_interval\\n'\n            \"\\n\"\n        )\n        txt = txt.replace(marker, block + marker, 1); changed = True\n        results[\"config_autoenable\"] = \"patched\"\n    else:\n        results[\"config_autoenable\"] = \"WARN: webhook section not found\"\nelse:\n    results[\"config_autoenable\"] = \"already present\"\n\nif changed:\n    config_py.write_text(txt, encoding=\"utf-8\")\n    results[\"config_py\"] = \"written\"\nelse:\n    results[\"config_py\"] = \"no changes needed\"\n\ntxt2 = run_py.read_text(encoding=\"utf-8\")\nchanged2 = False\n\nif \"elif platform == Platform.HBF_BUS:\" not in txt2:\n    old = \"            return YuanbaoAdapter(config)\\n\\n        return None\"\n    new = (\n        \"            return YuanbaoAdapter(config)\\n\"\n        \"\\n\"\n        \"        elif platform == Platform.HBF_BUS:\\n\"\n        \"            from gateway.platforms.hbf_bus import HBFBusAdapter, check_hbf_bus_requirements\\n\"\n        \"            if not check_hbf_bus_requirements():\\n\"\n        \"                logger.warning(\\\"HBF Bus: requirements not met\\\")\\n\"\n        \"                return None\\n\"\n        \"            return HBFBusAdapter(config)\\n\"\n        \"\\n\"\n        \"        return None\"\n    )\n    if old in txt2:\n        txt2 = txt2.replace(old, new, 1); changed2 = True\n        results[\"run_adapter\"] = \"patched\"\n    else:\n        results[\"run_adapter\"] = \"WARN: YuanbaoAdapter return anchor not found\"\nelse:\n    results[\"run_adapter\"] = \"already present\"\n\nif changed2:\n    run_py.write_text(txt2, encoding=\"utf-8\")\n    results[\"run_py\"] = \"written\"\nelse:\n    results[\"run_py\"] = \"no changes needed\"\n\nprint(json.dumps(results))\n";

// ── Install detection ─────────────────────────────────────────────────────────

interface HermesInstall {
  hermesHome: string;
  agentDir: string;
  python: string;
  dotenv: string;
  isWSLtoWindows: boolean;
}

function detectHermesInstall(): HermesInstall | null {
  const home = homedir();
  const isWSL =
    existsSync('/proc/version') &&
    readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');

  const candidates: Array<{ h: string; wslWin: boolean }> = [];
  if (process.env.HERMES_HOME) candidates.push({ h: process.env.HERMES_HOME, wslWin: false });
  candidates.push({ h: join(home, '.hermes'), wslWin: false });

  if (isWSL) {
    try {
      const winUser = execSync('cmd.exe /c echo %USERNAME%', {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (winUser && winUser !== '%USERNAME%') {
        candidates.push({ h: `/mnt/c/Users/${winUser}/AppData/Local/hermes`, wslWin: true });
      }
    } catch { /* ignore */ }
  }

  for (const { h, wslWin } of candidates) {
    const agentDir = join(h, 'hermes-agent');
    if (existsSync(join(agentDir, 'gateway', 'config.py'))) {
      const venvPy = join(agentDir, 'venv', 'bin', 'python3');
      return {
        hermesHome: h,
        agentDir,
        python: existsSync(venvPy) ? venvPy : 'python3',
        dotenv: join(h, '.env'),
        isWSLtoWindows: wslWin,
      };
    }
  }
  return null;
}

function hermesCliPath(install: HermesInstall): string {
  const localBin = join(homedir(), '.local', 'bin', 'hermes');
  return existsSync(localBin) ? localBin : 'hermes';
}

function ensureEnvEntry(dotenvPath: string, key: string, value: string): 'added' | 'exists' {
  let content = existsSync(dotenvPath) ? readFileSync(dotenvPath, 'utf8') : '';
  if (new RegExp(`^${key}=`, 'm').test(content)) return 'exists';
  content += (content.endsWith('\n') ? '' : '\n') + `${key}=${value}\n`;
  writeFileSync(dotenvPath, content, 'utf8');
  return 'added';
}

// ── Tool: hermes_setup ────────────────────────────────────────────────────────

export interface HermesSetupParams {
  api_server_key?: string;
  api_server_port?: number;
  restart?: boolean;
}

export async function hermesSetup(
  params: HermesSetupParams,
  claims: PassportClaims,
): Promise<{
  status: 'ok' | 'error';
  hermes_home?: string;
  steps: Record<string, string>;
  message: string;
}> {
  enforceTrust(claims, HERMES_SETUP_TOOL);
  const steps: Record<string, string> = {};

  const install = detectHermesInstall();
  if (!install) {
    return {
      status: 'error',
      steps,
      message:
        'No Hermes install found. Install Hermes first ' +
        '(https://github.com/NousResearch/hermes-agent), then re-run hermes_setup.',
    };
  }
  steps['detect'] = `found: ${install.hermesHome}`;

  // Write adapter file
  const adapterDest = join(install.agentDir, 'gateway', 'platforms', 'hbf_bus.py');
  try {
    writeFileSync(adapterDest, HBF_BUS_PY, 'utf8');
    steps['adapter_file'] = `written: ${adapterDest}`;
  } catch (e) {
    return { status: 'error', steps, message: `Failed to write adapter: ${e}` };
  }

  // Run patcher (idempotent)
  try {
    const r = spawnSync(install.python, ['-c', PATCH_PY, install.agentDir], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONPATH: install.agentDir },
    });
    if (r.status !== 0) {
      steps['patch'] = `error: ${r.stderr?.slice(0, 300)}`;
    } else {
      Object.assign(steps, JSON.parse(r.stdout.trim()) as Record<string, string>);
    }
  } catch (e) { steps['patch'] = `exception: ${e}`; }

  // Ensure .env entries
  const apiKey  = params.api_server_key ?? 'hbf-hermes-bridge-key';
  const apiPort = String(params.api_server_port ?? 8642);
  steps['env_API_SERVER_ENABLED'] = ensureEnvEntry(install.dotenv, 'API_SERVER_ENABLED', 'true');
  steps['env_API_SERVER_KEY']     = ensureEnvEntry(install.dotenv, 'API_SERVER_KEY', apiKey);
  steps['env_API_SERVER_PORT']    = ensureEnvEntry(install.dotenv, 'API_SERVER_PORT', apiPort);

  // WSL targeting Windows-side db: set HBF_BUS_DB_PATH
  if (install.isWSLtoWindows) {
    const parts = install.hermesHome.split('/');
    const winUser = parts[4] ?? '';
    if (winUser) {
      const winDb = `/mnt/c/Users/${winUser}/.hands-and-feet/data.db`;
      steps['env_HBF_BUS_DB_PATH'] = ensureEnvEntry(install.dotenv, 'HBF_BUS_DB_PATH', winDb);
    }
  }

  // Restart gateway
  if (params.restart !== false) {
    try {
      const r = spawnSync(hermesCliPath(install), ['gateway', 'restart'], {
        encoding: 'utf8',
        env: { ...process.env, HERMES_HOME: install.hermesHome },
        timeout: 30_000,
      });
      steps['restart'] = r.status === 0
        ? 'ok'
        : `exit ${r.status}: ${r.stderr?.slice(0, 200)}`;
    } catch (e) { steps['restart'] = `exception: ${e}`; }
  }

  return {
    status: 'ok',
    hermes_home: install.hermesHome,
    steps,
    message:
      'HBF bus adapter installed. ' +
      'Send messages with bus_send(to_agent="hermes", payload={text:"..."}) ' +
      'and read replies with bus_poll(agent_id="<your-agent-id>").',
  };
}

// ── Tool: hermes_status ───────────────────────────────────────────────────────

export async function hermesStatus(
  _params: Record<string, never>,
  claims: PassportClaims,
): Promise<{
  installed: boolean;
  hermes_home: string | null;
  adapter_present: boolean;
  gateway_running: boolean;
  details: Record<string, string>;
}> {
  enforceTrust(claims, HERMES_STATUS_TOOL);

  const install = detectHermesInstall();
  if (!install) {
    return {
      installed: false, hermes_home: null, adapter_present: false,
      gateway_running: false, details: { detect: 'no hermes install found' },
    };
  }

  const details: Record<string, string> = { hermes_home: install.hermesHome };

  const adapterPresent = existsSync(join(install.agentDir, 'gateway', 'platforms', 'hbf_bus.py'));
  details['adapter_file'] = adapterPresent ? 'present' : 'missing — run hermes_setup';

  try {
    const cfg = readFileSync(join(install.agentDir, 'gateway', 'config.py'), 'utf8');
    details['config_patched'] = cfg.includes('HBF_BUS = "hbf_bus"') ? 'yes' : 'no — run hermes_setup';
  } catch { details['config_patched'] = 'unreadable'; }

  let gatewayRunning = false;
  try {
    const r = spawnSync(hermesCliPath(install), ['gateway', 'status'], {
      encoding: 'utf8',
      env: { ...process.env, HERMES_HOME: install.hermesHome },
      timeout: 5_000,
    });
    gatewayRunning = r.status === 0;
    details['gateway'] = r.stdout?.trim().slice(0, 100) || (gatewayRunning ? 'running' : 'stopped');
  } catch { details['gateway'] = 'unknown'; }

  return { installed: true, hermes_home: install.hermesHome, adapter_present: adapterPresent, gateway_running: gatewayRunning, details };
}
