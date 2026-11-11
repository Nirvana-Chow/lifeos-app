# Bounded runner CJK font preparation

This is a CI-only repair of the existing required/visual qualification font step,
under the existing unified-business-ui delivery gates (1.2/3.1/3.2), not a new
product feature or evidence of owner acceptance.

The observed required run `42071910538`, job `127401997324`, completed APT index
updates but stalled after fetching `fonts-noto-cjk` from the Azure HTTP mirror.
Application/Auth/PostgreSQL checks were green; no evidence identified an app build
failure. The old font step had no step-level timeout. The canceled run remains
failed/canceled evidence and cannot be promoted to a full-green receipt.

The repair reuses the same Ubuntu noble package `1:20230817+repack1-3`. The
[official download metadata](https://packages.ubuntu.com/noble/all/fonts-noto-cjk/download)
specifies 61,229,778 bytes and SHA256
`7d64b985f6fe128c99eae5610d5c047338e572bdcfb2bb09736be01b824a7f6c`.
It downloads only that package from [Ubuntu's HTTPS archive](https://archive.ubuntu.com/ubuntu/pool/main/f/fonts-noto-cjk/),
with a transport-failure fallback to the same fixed package at
[Ubuntu's security archive](https://security.ubuntu.com/ubuntu/pool/main/f/fonts-noto-cjk/).
[Ubuntu's project documentation](https://ubuntu.com/project/docs/how-ubuntu-is-made/concepts/package-archive/)
identifies these as the same official archive servers. The second hostname can
avoid a hostname-specific DNS failure; it is not an independent backend or a
guarantee against all Ubuntu or runner network outages. A successful download
that fails its hash or metadata is rejected without trying another artifact.
The helper uses no APT index refreshes or unrelated repository access. A private
temporary download on macOS matched that hash; its control metadata had the same
name/version/architecture and its complete copyright file was 14,712 bytes,
including SIL-1.1 fonts and GPL-3+ Debian packaging. Nothing was installed locally,
and no package or font binary is committed or shipped in the application.

The helper first checks the installed status and exact version. Otherwise it
snapshots an optional runner-local `.deb` cache into a private temporary directory,
or downloads the fixed package. Every cache hit/download must pass the pinned
SHA256 and package identity before privileged `dpkg` execution. Cache corruption
fails closed. This local cache is not an Actions cross-run cache and adds no
action dependency, service or permission. The unchanged package installation
preserves the complete upstream copyright under `/usr/share/doc/fonts-noto-cjk/`.

The helper has a 180-second overall deadline (plus at most 5 seconds before kill),
including cache, download, installation and installed-status readback. `curl` has
10-second connection/65-second transfer limits, one attempt per official hostname
(two attempts total), no intra-host retries and low-speed detection. Its
[official connection-timeout documentation](https://curl.se/docs/manpage.html#--connect-timeout)
includes DNS resolution in that budget; the outer timeout supplies the absolute
wall-clock bound. The privileged `dpkg` child has its own 35-second
deadline plus 5 seconds before kill. Both workflow steps have a four-minute hard
limit; `fc-cache`, Chinese `fc-match` and Chrome version checks also have deadlines.
The original copyright, Chinese-family oracle, Chrome/NSS requirements and all UI
assertions remain required.

Regression command: `node --test test/ci-cjk-fonts.test.ts test/release-visual-workflow.test.ts`.
Fixtures isolate package/network/privileged commands and cover exact-installed
reuse, cache reuse, cold download, poison-cache rejection using the real SHA256
tool, corrupt download, download failure, metadata mismatch, install failure and
failed installed-status readback. A stalled-transfer test checks the production
deadline invocation and uses the real timeout with a five-second test clock to
prove termination before installation. The workflow contract test retains the font,
copyright and browser checks. These simulations are not Linux installation or
rendering acceptance: the new exact SHA must pass the existing real Linux CI.

The private eligibility configuration pins the required workflow digest. The
coordinator must update that binding through the existing controlled process and
retain old receipt evidence; a workflow edit does not authorize reusing old green
runs. Rollback is this source slice plus the matching controlled digest binding,
not a weakened qualification gate.

## 2026-11-12 DNS failure and minimal correction

The target remains successful real Linux font/license/Chinese-family qualification
under the existing UI delivery gates. Coordinator readback on unchanged MCP source
`130d77303179beda791022a18c30fc1e0611324e` found unit/types/webpack/Auth/PostgreSQL
checks successful, but recovery job `130642900785` and its one failed-job retry
`130653899066` both stopped at two ten-second archive-host DNS timeouts (curl28).
These are two infrastructure attempts, with no source repair between them; no
third blind retry was performed and neither partial run is full-green evidence.

The proven boundary is hostname resolution before package download. It does not
prove a general DNS configuration error or an application regression. The official
Ubuntu metadata still lists the exact version/hash above. Local HTTPS HEAD checks
for both archive hostnames returned 200 and 61,229,778 bytes; a complete download
from the security hostname matched the same pinned SHA256. Ubuntu snapshot service
was investigated but its local TLS attempt timed out, so it is not an additional
fallback. The existing installed-package and checked cache paths remain unchanged;
no cross-run cache action, global DNS change, new mirror or package is added.

The sole source repair replaces two attempts at one hostname with one attempt at
each of the two documented official hostnames. Regression first reproduced the
archive-only failure with no fallback and then passed fallback success and corrupt
fallback rejection. Hash/metadata failure never triggers alternate-artifact use.

The pre-existing one-second test clock also reproduced an earlier prerequisite
timeout before curl began. Only that test clock is now five seconds, with an
explicit stalled-curl-start marker, real timeout exit124, a nine-second test upper
bound and zero privileged installation. The production 180-second and privileged
35-second deadlines are unchanged. Focused shell/release tests passed 15/15 with
zero skips; these fixtures do not establish Linux package installation or browser
acceptance. The next and deciding validation is the original required GitHub
qualification on the new fixed source. If both official sources remain unavailable,
retain the failure and investigate new evidence instead of adding unverified hosts
or weakening the font gate. Rollback is this helper/test/documentation change.
