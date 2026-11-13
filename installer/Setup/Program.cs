// Character Studio OFFLINE Setup — copies local payload (no download).
// Rebuild via installer\Build-OfflinePackage.ps1
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

static class Program
{
    public const string AppName = "Character Studio";
    public const string Kind = "Offline";
    public const string AppId = "{8F3C2A1B-6D4E-4B9A-A2C1-91E0D7B5F4A3}";
    public const string Version = "1.0.0";
    public const string ExeName = "CharacterStudio.exe";

    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new SetupForm());
    }
}

sealed class SetupForm : Form
{
    readonly TextBox _pathBox;
    readonly CheckBox _desktopBox;
    readonly CheckBox _launchBox;
    readonly Button _browseBtn;
    readonly Button _installBtn;
    readonly Button _cancelBtn;
    readonly ProgressBar _progress;
    readonly Label _status;
    readonly string _setupDir;
    readonly string _payloadDir;
    bool _busy;

    public SetupForm()
    {
        _setupDir = Path.GetDirectoryName(Application.ExecutablePath) ?? Environment.CurrentDirectory;
        _payloadDir = Path.Combine(_setupDir, "payload");

        Text = Program.AppName + " — Offline Installer (full package, no download)";
        Width = 520;
        Height = 360;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        try
        {
            string ico = Path.Combine(_payloadDir, "CharacterStudio.ico");
            if (!File.Exists(ico)) ico = Path.Combine(_setupDir, "CharacterStudio.ico");
            if (File.Exists(ico)) Icon = new Icon(ico);
        }
        catch { }

        var title = new Label
        {
            Text = "Offline Installer",
            Font = new Font("Segoe UI", 14F, FontStyle.Bold),
            AutoSize = true,
            Location = new Point(24, 20),
        };
        var blurb = new Label
        {
            Text = "Full USB/zip package. Copies app + runtime from the payload folder next to this Setup.\r\n" +
                   "No internet download. For Git clones that download runtime, use the Online Installer instead.",
            Location = new Point(24, 56),
            Size = new Size(460, 48),
        };

        var pathLabel = new Label { Text = "Install folder", AutoSize = true, Location = new Point(24, 118) };
        _pathBox = new TextBox
        {
            Location = new Point(24, 140),
            Width = 360,
            Text = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", "CharacterStudio"),
        };
        _browseBtn = new Button { Text = "Browse…", Location = new Point(396, 138), Width = 88 };
        _browseBtn.Click += (_, __) => Browse();

        _desktopBox = new CheckBox
        {
            Text = "Create a desktop shortcut",
            Checked = true,
            AutoSize = true,
            Location = new Point(24, 178),
        };
        _launchBox = new CheckBox
        {
            Text = "Launch when finished",
            Checked = true,
            AutoSize = true,
            Location = new Point(24, 202),
        };

        _progress = new ProgressBar
        {
            Location = new Point(24, 240),
            Width = 460,
            Style = ProgressBarStyle.Marquee,
            MarqueeAnimationSpeed = 0,
            Visible = false,
        };
        _status = new Label
        {
            Text = ReadyStatus(),
            Location = new Point(24, 268),
            Size = new Size(460, 20),
            ForeColor = Color.DimGray,
        };

        _installBtn = new Button { Text = "Install", Width = 100, Location = new Point(272, 292) };
        _cancelBtn = new Button { Text = "Cancel", Width = 100, Location = new Point(384, 292) };
        _installBtn.Click += (_, __) => BeginInstall();
        _cancelBtn.Click += (_, __) =>
        {
            if (_busy) return;
            Close();
        };

        Controls.Add(title);
        Controls.Add(blurb);
        Controls.Add(pathLabel);
        Controls.Add(_pathBox);
        Controls.Add(_browseBtn);
        Controls.Add(_desktopBox);
        Controls.Add(_launchBox);
        Controls.Add(_progress);
        Controls.Add(_status);
        Controls.Add(_installBtn);
        Controls.Add(_cancelBtn);

        AcceptButton = _installBtn;
        CancelButton = _cancelBtn;
    }

    string ReadyStatus()
    {
        if (!Directory.Exists(_payloadDir) || !File.Exists(Path.Combine(_payloadDir, Program.ExeName)))
            return "Payload folder not found next to Setup.exe. Run Build-Payload.ps1 first.";
        if (!File.Exists(Path.Combine(_payloadDir, "runtime", "python", "pythonw.exe")))
            return "Warning: runtime\\python is missing. Generation and bind will not work.";
        return "Ready to install.";
    }

    void Browse()
    {
        using (var dlg = new FolderBrowserDialog())
        {
            dlg.Description = "Choose install folder";
            dlg.SelectedPath = _pathBox.Text;
            if (dlg.ShowDialog(this) == DialogResult.OK)
                _pathBox.Text = dlg.SelectedPath;
        }
    }

    void SetBusy(bool busy, string status)
    {
        _busy = busy;
        _pathBox.Enabled = !busy;
        _browseBtn.Enabled = !busy;
        _desktopBox.Enabled = !busy;
        _launchBox.Enabled = !busy;
        _installBtn.Enabled = !busy;
        _cancelBtn.Enabled = !busy;
        _progress.Visible = busy;
        _progress.MarqueeAnimationSpeed = busy ? 30 : 0;
        _status.Text = status;
        _status.ForeColor = busy ? Color.Black : Color.DimGray;
        Application.DoEvents();
    }

    void BeginInstall()
    {
        string dest = (_pathBox.Text ?? "").Trim();
        if (string.IsNullOrWhiteSpace(dest))
        {
            MessageBox.Show(this, "Choose an install folder.", Program.AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        if (!Directory.Exists(_payloadDir) || !File.Exists(Path.Combine(_payloadDir, Program.ExeName)))
        {
            MessageBox.Show(this,
                "The payload folder is missing next to Setup.exe.\r\n\r\n" +
                "Build with installer\\Build-Payload.ps1, then copy the whole CharacterStudio-Install folder.",
                Program.AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        try
        {
            SetBusy(true, "Copying files…");
            Directory.CreateDirectory(dest);
            Robocopy(_payloadDir, dest);
            string uninstallExe = Path.Combine(_setupDir, "Uninstall.exe");
            if (File.Exists(uninstallExe))
                File.Copy(uninstallExe, Path.Combine(dest, "Uninstall.exe"), true);

            SetBusy(true, "Creating shortcuts…");
            string exePath = Path.Combine(dest, Program.ExeName);
            string icoPath = Path.Combine(dest, "CharacterStudio.ico");
            string iconLoc = File.Exists(icoPath) ? icoPath + ",0" : exePath + ",0";
            string startDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
                "Programs", Program.AppName);
            Directory.CreateDirectory(startDir);
            WriteShortcut(Path.Combine(startDir, Program.AppName + ".lnk"), exePath, dest, iconLoc);
            WriteShortcut(Path.Combine(startDir, "Uninstall " + Program.AppName + ".lnk"),
                Path.Combine(dest, "Uninstall.exe"), dest, iconLoc);
            if (_desktopBox.Checked)
            {
                string desk = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                WriteShortcut(Path.Combine(desk, Program.AppName + ".lnk"), exePath, dest, iconLoc);
            }

            SetBusy(true, "Registering uninstaller…");
            WriteInstallMeta(dest);
            RegisterUninstall(dest, exePath);

            SetBusy(false, "Installed.");
            MessageBox.Show(this, Program.AppName + " is installed.\r\n\r\n" + dest,
                Program.AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);

            if (_launchBox.Checked)
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = exePath,
                    WorkingDirectory = dest,
                    UseShellExecute = true,
                });
            }
            Close();
        }
        catch (Exception ex)
        {
            SetBusy(false, "Install failed.");
            MessageBox.Show(this, ex.Message, Program.AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    static void Robocopy(string from, string to)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "robocopy.exe",
            Arguments = "\"" + from + "\" \"" + to + "\" /E /NFL /NDL /NJH /NJS /NP /R:2 /W:2",
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        using (var p = Process.Start(psi))
        {
            if (p == null) throw new Exception("Could not start robocopy.");
            p.WaitForExit();
            if (p.ExitCode >= 8)
                throw new Exception("File copy failed (robocopy exit " + p.ExitCode + ").");
        }
    }

    static void WriteShortcut(string linkPath, string target, string workDir, string iconLoc)
    {
        Type t = Type.GetTypeFromProgID("WScript.Shell");
        object shell = Activator.CreateInstance(t);
        object sc = t.InvokeMember("CreateShortcut",
            System.Reflection.BindingFlags.InvokeMethod, null, shell, new object[] { linkPath });
        Type st = sc.GetType();
        st.InvokeMember("TargetPath", System.Reflection.BindingFlags.SetProperty, null, sc, new object[] { target });
        st.InvokeMember("WorkingDirectory", System.Reflection.BindingFlags.SetProperty, null, sc, new object[] { workDir });
        st.InvokeMember("IconLocation", System.Reflection.BindingFlags.SetProperty, null, sc, new object[] { iconLoc });
        st.InvokeMember("Save", System.Reflection.BindingFlags.InvokeMethod, null, sc, null);
    }

    static void WriteInstallMeta(string dest)
    {
        string json =
            "{\r\n" +
            "  \"InstallDir\": " + JsonString(dest) + ",\r\n" +
            "  \"AllUsers\": false,\r\n" +
            "  \"AppId\": " + JsonString(Program.AppId) + ",\r\n" +
            "  \"AppName\": " + JsonString(Program.AppName) + ",\r\n" +
            "  \"Version\": " + JsonString(Program.Version) + "\r\n" +
            "}\r\n";
        File.WriteAllText(Path.Combine(dest, "install.json"), json, Encoding.UTF8);
    }

    static string JsonString(string s)
    {
        return "\"" + (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }

    static void RegisterUninstall(string dest, string exePath)
    {
        string keyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + Program.AppId;
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(keyPath))
        {
            if (key == null) return;
            string uninstall = Path.Combine(dest, "Uninstall.exe");
            key.SetValue("DisplayName", Program.AppName);
            key.SetValue("DisplayVersion", Program.Version);
            key.SetValue("Publisher", Program.AppName);
            key.SetValue("InstallLocation", dest);
            key.SetValue("DisplayIcon", exePath);
            key.SetValue("UninstallString", "\"" + uninstall + "\"");
            key.SetValue("QuietUninstallString", "\"" + uninstall + "\" /S");
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
    }
}
