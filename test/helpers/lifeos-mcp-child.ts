// Internal synthetic process only; no credential file, Keychain, production origin or host settings.
import {serveLifeOSMcp} from '../../src/mcp-candidate/stdio.ts';
serveLifeOSMcp({origin:process.argv[2],credentialProvider:async()=>'synthetic-stdio-provider-key'});
