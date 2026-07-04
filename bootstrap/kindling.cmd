@echo off
REM Kindling bootstrap entry — Windows. The user downloads THIS ONE FILE and double-clicks it.
REM It FETCHES + runs the setup script from the host, so no sibling files are needed (the earlier
REM `-File %~dp0setup.ps1` required setup.ps1 + lib\common.ps1 next to the .cmd, which a lone
REM download doesn't have). Mirrors the macOS/Linux one-liner `curl -fsSL .../install | bash`.
REM   -ExecutionPolicy Bypass : lets the unsigned setup script run FOR THIS PROCESS ONLY
REM                             (it does not change any system-wide policy — safe + reversible).
REM   -NoProfile              : skips the user's PowerShell profile so nothing interferes (required).
REM   irm ... | iex           : Invoke-RestMethod fetches setup.ps1 over HTTPS, Invoke-Expression
REM                             runs it (the PowerShell equivalent of curl|bash). setup.ps1 is
REM                             self-contained (helpers inlined), so no on-disk siblings are needed.
powershell -ExecutionPolicy Bypass -NoProfile -Command "irm https://kindling.aiviatic.com/setup.ps1 | iex"
pause
