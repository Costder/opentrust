import Docker from 'dockerode';
import { enforceTrust } from '../../trust.js';
import type { PassportClaims, ToolDefinition } from '../../types.js';

// ────────────────────────────────────────────────────────────
// Tool definitions
// ────────────────────────────────────────────────────────────
const RUN_CONTAINER_TOOL: ToolDefinition = { name: 'run_container', minTrustLevel: 4 };
const STOP_CONTAINER_TOOL: ToolDefinition = { name: 'stop_container', minTrustLevel: 4 };
const REMOVE_CONTAINER_TOOL: ToolDefinition = { name: 'remove_container', minTrustLevel: 4 };
const LIST_CONTAINERS_TOOL: ToolDefinition = { name: 'list_containers', minTrustLevel: 2 };
const CONTAINER_LOGS_TOOL: ToolDefinition = { name: 'container_logs', minTrustLevel: 2 };
const EXEC_IN_CONTAINER_TOOL: ToolDefinition = { name: 'exec_in_container', minTrustLevel: 4 };

export const DOCKER_TOOLS = {
  run_container: RUN_CONTAINER_TOOL,
  stop_container: STOP_CONTAINER_TOOL,
  remove_container: REMOVE_CONTAINER_TOOL,
  list_containers: LIST_CONTAINERS_TOOL,
  container_logs: CONTAINER_LOGS_TOOL,
  exec_in_container: EXEC_IN_CONTAINER_TOOL,
};

// Factory — allows easy mocking in tests
export function getDocker(): Docker {
  return new Docker();
}

// ────────────────────────────────────────────────────────────
// Tools
// ────────────────────────────────────────────────────────────
export async function runContainer(
  params: {
    image: string;
    name?: string;
    env?: string[];
    ports?: Record<string, string>;
  },
  claims: PassportClaims,
): Promise<{ id: string; name: string; image: string; status: string }> {
  enforceTrust(claims, RUN_CONTAINER_TOOL);

  const docker = getDocker();

  // Build port bindings
  const exposedPorts: Record<string, Record<string, never>> = {};
  const portBindings: Record<string, Array<{ HostPort: string }>> = {};
  if (params.ports) {
    for (const [containerPort, hostPort] of Object.entries(params.ports)) {
      const key = containerPort.includes('/') ? containerPort : `${containerPort}/tcp`;
      exposedPorts[key] = {};
      portBindings[key] = [{ HostPort: hostPort }];
    }
  }

  const container = await docker.createContainer({
    Image: params.image,
    name: params.name,
    Env: params.env,
    ExposedPorts: exposedPorts,
    HostConfig: {
      PortBindings: portBindings,
    },
  }) as Docker.Container;

  await (container as Docker.Container).start();
  const info = await (container as Docker.Container).inspect();

  return {
    id: (container as Docker.Container).id,
    name: (info as Docker.ContainerInspectInfo).Name.replace(/^\//, ''),
    image: params.image,
    status: (info as Docker.ContainerInspectInfo).State.Status,
  };
}

export async function stopContainer(
  params: { id: string },
  claims: PassportClaims,
): Promise<{ id: string; stopped: boolean }> {
  enforceTrust(claims, STOP_CONTAINER_TOOL);

  const docker = getDocker();
  const container = docker.getContainer(params.id);
  await container.stop();

  return { id: params.id, stopped: true };
}

export async function removeContainer(
  params: { id: string; force?: boolean },
  claims: PassportClaims,
): Promise<{ id: string; removed: boolean }> {
  enforceTrust(claims, REMOVE_CONTAINER_TOOL);

  const docker = getDocker();
  const container = docker.getContainer(params.id);
  await container.remove({ force: params.force ?? false });

  return { id: params.id, removed: true };
}

export async function listContainers(
  params: { all?: boolean },
  claims: PassportClaims,
): Promise<{ containers: Docker.ContainerInfo[] }> {
  enforceTrust(claims, LIST_CONTAINERS_TOOL);

  const docker = getDocker();
  const containers = await docker.listContainers({ all: params.all ?? false });

  return { containers };
}

export async function containerLogs(
  params: { id: string; tail?: number },
  claims: PassportClaims,
): Promise<{ id: string; logs: string }> {
  enforceTrust(claims, CONTAINER_LOGS_TOOL);

  const docker = getDocker();
  const container = docker.getContainer(params.id);
  const logsBuffer = await container.logs({
    stdout: true,
    stderr: true,
    tail: params.tail ?? 100,
  });

  const logs =
    typeof logsBuffer === 'string'
      ? logsBuffer
      : (logsBuffer as Buffer).toString('utf8');

  return { id: params.id, logs };
}

export async function execInContainer(
  params: { id: string; command: string[] },
  claims: PassportClaims,
): Promise<{ id: string; output: string; exit_code: number }> {
  enforceTrust(claims, EXEC_IN_CONTAINER_TOOL);

  const docker = getDocker();
  const container = docker.getContainer(params.id);

  const exec = await container.exec({
    Cmd: params.command,
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = await exec.start({ hijack: true, stdin: false });

  const output = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });

  const inspectResult = await exec.inspect();
  const exitCode = inspectResult.ExitCode ?? -1;

  return { id: params.id, output, exit_code: exitCode };
}
