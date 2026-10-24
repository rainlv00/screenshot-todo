; 截图待办 安装器脚本
; 编译：makensis /DVERSION=1.0.0 /DSRCDIR=..\release\截图待办-win32-x64 installer.nsi
; 装到用户目录，不需要管理员权限；数据在 %APPDATA% 不受影响

Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!ifndef SRCDIR
  !define SRCDIR "..\release\截图待办-win32-x64"
!endif
!ifndef OUTDIR
  !define OUTDIR "..\release"
!endif

!define APPNAME "截图待办"
!define APPEXE "截图待办.exe"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\截图待办"

Name "${APPNAME}"
OutFile "${OUTDIR}\ScreenshotTodo-Setup.exe"
InstallDir "D:\Programs\${APPNAME}"
InstallDirRegKey HKCU "Software\${APPNAME}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
BrandingText "${APPNAME} v${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} 安装程序"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "WDY"
VIAddVersionKey "LegalCopyright" ""

!define MUI_ICON "..\build\icon.ico"
!define MUI_UNICON "..\build\icon.ico"
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_RUN "$INSTDIR\${APPEXE}"
!define MUI_FINISHPAGE_RUN_TEXT "立即运行 ${APPNAME}"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
  ; 没有 D 盘就退回用户目录
  IfFileExists "D:\*.*" +2
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${APPNAME}"

  ; 已经装过就先卸掉旧版，避免残留文件
  ReadRegStr $0 HKCU "${REGKEY}" "UninstallString"
  StrCmp $0 "" done
    ReadRegStr $1 HKCU "Software\${APPNAME}" "InstallDir"
    StrCmp $1 "" done
    IfFileExists "$1\Uninstall.exe" 0 done
    ExecWait '"$1\Uninstall.exe" /S _?=$1'
  done:
FunctionEnd

Section "Install"
  ; 关掉正在运行的实例，否则文件被占用
  nsExec::Exec 'taskkill /F /IM "${APPEXE}"'
  Sleep 800

  SetOutPath "$INSTDIR"
  File /r "${SRCDIR}\*.*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${APPEXE}" "" "$INSTDIR\${APPEXE}" 0
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${APPEXE}" "" "$INSTDIR\${APPEXE}" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}\卸载 ${APPNAME}.lnk" "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "Software\${APPNAME}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\${APPEXE}"
  WriteRegStr HKCU "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${REGKEY}" "Publisher" "WDY"
  WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${REGKEY}" "EstimatedSize" "$0"
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM "${APPEXE}"'
  Sleep 800

  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"

  ; 只删程序目录，用户数据在 %APPDATA%\截图待办，保留
  RMDir /r "$INSTDIR"

  DeleteRegKey HKCU "${REGKEY}"
  DeleteRegKey HKCU "Software\${APPNAME}"
SectionEnd
