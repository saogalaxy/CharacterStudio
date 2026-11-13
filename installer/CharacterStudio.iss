; One-file Character Studio installer (Inno Setup 6).
; Build: installer\Build-OneClick.ps1
; Output: dist\CharacterStudio-Setup.exe

#define MyAppName "Character Studio"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Character Studio"
#define MyAppExeName "CharacterStudio.exe"
#define PayloadRoot "..\dist\CharacterStudio-Install\payload"

[Setup]
AppId={{8F3C2A1B-6D4E-4B9A-A2C1-91E0D7B5F4A3}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\CharacterStudio
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\dist
OutputBaseFilename=CharacterStudio-Setup
SetupIconFile=..\CharacterStudio.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
; Fast compression so a ~70GB pack finishes in reasonable time.
Compression=lzma2/fast
SolidCompression=no
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
CloseApplications=yes
RestartApplications=no
; Windows caps a single Setup.exe near 4GB. This app's runtime is far
; larger, so spanning writes Setup.exe plus setup-*.bin pieces that must
; stay together. Prefer the CharacterStudio-Install folder package for
; a simple zip → Setup.exe flow.
DiskSpanning=yes
DiskClusterSize=2100000000

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "{#PayloadRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
Name: "{app}\jobs"

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch Character Studio"; Flags: nowait postinstall skipifsilent

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
  if not FileExists(ExpandConstant('{#SourcePath}\{#PayloadRoot}\CharacterStudio.exe')) then
  begin
    MsgBox('Payload is missing. Run installer\Build-Payload.ps1 first.', mbError, MB_OK);
    Result := False;
  end
  else if not FileExists(ExpandConstant('{#SourcePath}\{#PayloadRoot}\runtime\python\pythonw.exe')) then
  begin
    MsgBox('runtime\python is missing from the payload. Use a full Build-Payload (not -AppOnly).', mbError, MB_OK);
    Result := False;
  end;
end;
