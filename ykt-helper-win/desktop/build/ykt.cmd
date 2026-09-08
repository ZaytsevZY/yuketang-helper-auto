@echo off
setlocal
if exist "%~dp0YuketangHelper.exe" (
  set "YKT_APP=%~dp0YuketangHelper.exe"
  set "YKT_CLI=%~dp0resources\ykt-cli.cjs"
) else (
  set "YKT_APP=%~dp0..\YuketangHelper.exe"
  set "YKT_CLI=%~dp0ykt-cli.cjs"
)
set "ELECTRON_RUN_AS_NODE=1"
"%YKT_APP%" "%YKT_CLI%" %*
