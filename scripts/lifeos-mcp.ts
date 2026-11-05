// Default closed. A reviewed host wrapper must inject its fixed-origin credential provider.
// No env/argv credential selection, secret-store read, network listener or host registration.
process.stderr.write('MCP_CREDENTIAL_RUNTIME_UNAVAILABLE\n');
process.exitCode=1;
