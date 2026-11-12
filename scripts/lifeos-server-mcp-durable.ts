// Source candidate only. Runtime adoption requires a separately reviewed fixed host.
// No environment, credentials, directory, broker, network or registration is inspected.
process.stderr.write('MCP_DURABLE_RUNTIME_NOT_ADOPTED\n');
process.exitCode=1;
