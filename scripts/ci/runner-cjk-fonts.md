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
without APT index refreshes or unrelated third-party repository access. A private
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
10-second connection/65-second transfer limits, at most one retry, a 135-second
retry budget and low-speed detection. Its [official documentation](https://curl.se/docs/manpage.html#--retry-max-time)
explains that the retry timer alone is not an absolute wall-clock limit; the outer
timeout supplies that bound. The privileged `dpkg` child has its own 35-second
deadline plus 5 seconds before kill. Both workflow steps have a four-minute hard
limit; `fc-cache`, Chinese `fc-match` and Chrome version checks also have deadlines.
The original copyright, Chinese-family oracle, Chrome/NSS requirements and all UI
assertions remain required.

Regression command: `node --test test/ci-cjk-fonts.test.ts test/release-visual-workflow.test.ts`.
Fixtures isolate package/network/privileged commands and cover exact-installed
reuse, cache reuse, cold download, poison-cache rejection using the real SHA256
tool, corrupt download, download failure, metadata mismatch, install failure and
failed installed-status readback. A stalled-transfer test checks the production
deadline invocation and uses the real timeout with a one-second test clock to
prove termination before installation. The workflow contract test retains the font,
copyright and browser checks. These simulations are not Linux installation or
rendering acceptance: the new exact SHA must pass the existing real Linux CI.

The private eligibility configuration pins the required workflow digest. The
coordinator must update that binding through the existing controlled process and
retain old receipt evidence; a workflow edit does not authorize reusing old green
runs. Rollback is this source slice plus the matching controlled digest binding,
not a weakened qualification gate.
