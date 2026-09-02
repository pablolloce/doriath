import { probeWorkspaceAgents } from "../src/integrations/codex-workspace-agents.mjs";

try {
  const result = await probeWorkspaceAgents();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (!result.proof.safe) {
    process.stderr.write("Google Workspace Agents probe used a tool outside the read-only allowlist.\n");
    process.exitCode = 4;
  } else if (!result.pluginAvailable) {
    process.stderr.write("Google Workspace Agents is not available to the current Codex session.\n");
    process.exitCode = 2;
  } else if (!result.proof.workspaceAgentsToolObserved) {
    process.stderr.write("Google Workspace Agents availability was not proven by a real tool call.\n");
    process.exitCode = 3;
  }
} catch (error) {
  process.stderr.write(`${error.message}${error.code ? ` (${error.code})` : ""}\n`);
  process.exitCode = 1;
}