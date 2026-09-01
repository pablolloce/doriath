import { runRepositoryCommand } from "./test-runner.mjs";

export async function runSonarGate({ repository, command, args = [], timeoutMs = 300000, env, onChunk, cancellationToken }) {
    const result = await runRepositoryCommand({
        repository,
        command,
        args,
        timeoutMs,
        env,
        onChunk,
        cancellationToken,
    });

    if (result.skipped) {
        return {
            ok: true,
            skipped: true,
            status: "skipped",
            message: result.message,
            logs: {
                stdout: result.stdout,
                stderr: result.stderr,
            },
        };
    }

    return {
        ok: result.ok,
        skipped: false,
        cancelled: Boolean(result.cancelled),
        status: result.ok ? "passed" : "failed",
        message: result.ok ? "Sonar quality gate command passed." : "Sonar quality gate command failed.",
        logs: {
            stdout: result.stdout,
            stderr: result.stderr,
        },
    };
}
