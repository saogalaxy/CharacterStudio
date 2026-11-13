// Character Studio ONLINE installer — downloads runtime, copies app from the Git repo.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Win32;

static class Program
{
    public const string AppName = "Character Studio";
    public const string Kind = "Online";
    public const string AppId = "{8F3C2A1B-6D4E-4B9A-A2C1-91E0D7B5F4A3}";
    public const string Version = "1.0.0";
    public const string ExeName = "CharacterStudio.exe";

    [STAThread]
    static void Main()
    {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new OnlineSetupForm());
    }
}

sealed class OnlineSetupForm : Form
{
    readonly TextBox _pathBox;
    readonly TextBox _urlBox;
    readonly CheckBox _desktopBox;
    readonly CheckBox _launchBox;
    readonly Button _browseBtn;
    readonly Button _installBtn;
    readonly Button _cancelBtn;
    readonly ProgressBar _progress;
    readonly Label _status;
    readonly string _setupDir;
    readonly string _repoRoot;
    bool _busy;

    public OnlineSetupForm()
    {
        _setupDir = Path.GetDirectoryName(Application.ExecutablePath) ?? Environment.CurrentDirectory;
        _repoRoot = FindRepoRoot(_setupDir);

        Text = Program.AppName + " — Online Installer (downloads runtime)";
        Width = 560;
        Height = 420;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;

        var title = new Label
        {
            Text = "Online Installer",
            Font = new Font("Segoe UI", 14F, FontStyle.Bold),
            AutoSize = true,
            Location = new Point(24, 16),
        };
        var blurb = new Label
        {
            Text = "For Git clones. Copies app code from this repo, then downloads the large runtime\r\n" +
                   "(ComfyUI, Blender, models). Use Offline Installer if you already have the full USB package.",
            Location = new Point(24, 48),
            Size = new Size(500, 40),
        };

        var pathLabel = new Label { Text = "Install folder", AutoSize = true, Location = new Point(24, 100) };
        _pathBox = new TextBox
        {
            Location = new Point(24, 120),
            Width = 400,
            Text = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", "CharacterStudio"),
        };
        _browseBtn = new Button { Text = "Browse…", Location = new Point(436, 118), Width = 88 };
        _browseBtn.Click += (_, __) =>
        {
            using (var dlg = new FolderBrowserDialog())
            {
                dlg.SelectedPath = _pathBox.Text;
                if (dlg.ShowDialog(this) == DialogResult.OK) _pathBox.Text = dlg.SelectedPath;
            }
        };

        var urlLabel = new Label
        {
            Text = "Runtime download URL (CharacterStudio-Runtime.zip)",
            AutoSize = true,
            Location = new Point(24, 158),
        };
        _urlBox = new TextBox
        {
            Location = new Point(24, 178),
            Width = 500,
            Text = ReadManifestUrl(),
        };

        _desktopBox = new CheckBox
        {
            Text = "Create a desktop shortcut",
            Checked = true,
            AutoSize = true,
            Location = new Point(24, 216),
        };
        _launchBox = new CheckBox
        {
            Text = "Launch when finished",
            Checked = true,
            AutoSize = true,
            Location = new Point(24, 240),
        };

        _progress = new ProgressBar
        {
            Location = new Point(24, 278),
            Width = 500,
            Style = ProgressBarStyle.Continuous,
        };
        _status = new Label
        {
            Text = ReadyStatus(),
            Location = new Point(24, 308),
            Size = new Size(500, 36),
            ForeColor = Color.DimGray,
        };

        _installBtn = new Button { Text = "Download & Install", Width = 140, Location = new Point(252, 350) };
        _cancelBtn = new Button { Text = "Cancel", Width = 100, Location = new Point(404, 350) };
        _installBtn.Click += (_, __) => BeginInstall();
        _cancelBtn.Click += (_, __) => { if (!_busy) Close(); };

        Controls.Add(title);
        Controls.Add(blurb);
        Controls.Add(pathLabel);
        Controls.Add(_pathBox);
        Controls.Add(_browseBtn);
        Controls.Add(urlLabel);
        Controls.Add(_urlBox);
        Controls.Add(_desktopBox);
        Controls.Add(_launchBox);
        Controls.Add(_progress);
        Controls.Add(_status);
        Controls.Add(_installBtn);
        Controls.Add(_cancelBtn);
        AcceptButton = _installBtn;
        CancelButton = _cancelBtn;
    }

    static string FindRepoRoot(string start)
    {
        var dir = new DirectoryInfo(start);
        while (dir != null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "app", "app.py")) &&
                Directory.Exists(Path.Combine(dir.FullName, "library")))
                return dir.FullName;
            if (dir.Name.Equals("installer", StringComparison.OrdinalIgnoreCase) && dir.Parent != null &&
                File.Exists(Path.Combine(dir.Parent.FullName, "app", "app.py")))
                return dir.Parent.FullName;
            dir = dir.Parent;
        }
        return start;
    }

    string ReadManifestUrl()
    {
        string[] candidates =
        {
            Path.Combine(_setupDir, "online-manifest.json"),
            Path.Combine(_repoRoot, "installer", "online-manifest.json"),
        };
        foreach (string path in candidates)
        {
            if (!File.Exists(path)) continue;
            try
            {
                string text = File.ReadAllText(path);
                Match m = Regex.Match(text, "\"runtimeBundleUrl\"\\s*:\\s*\"([^\"]*)\"");
                if (m.Success) return m.Groups[1].Value;
            }
            catch { }
        }
        return "";
    }

    string ReadyStatus()
    {
        if (!File.Exists(Path.Combine(_repoRoot, "app", "app.py")))
            return "Open this from a Character Studio Git checkout (app\\ and library\\ must be present).";
        if (string.IsNullOrWhiteSpace(_urlBox.Text))
            return "Set the runtime zip URL (or edit installer\\online-manifest.json), then install.";
        return "Ready. App from Git repo; runtime will be downloaded.";
    }

    void SetBusy(bool busy, string status)
    {
        _busy = busy;
        _pathBox.Enabled = !busy;
        _urlBox.Enabled = !busy;
        _browseBtn.Enabled = !busy;
        _desktopBox.Enabled = !busy;
        _launchBox.Enabled = !busy;
        _installBtn.Enabled = !busy;
        _cancelBtn.Enabled = !busy;
        _status.Text = status;
        _status.ForeColor = busy ? Color.Black : Color.DimGray;
        Application.DoEvents();
    }

    void BeginInstall()
    {
        string dest = (_pathBox.Text ?? "").Trim();
        string url = (_urlBox.Text ?? "").Trim();
        if (string.IsNullOrWhiteSpace(dest))
        {
            MessageBox.Show(this, "Choose an install folder.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        if (!File.Exists(Path.Combine(_repoRoot, "app", "app.py")))
        {
            MessageBox.Show(this, "This online installer must run from a Git checkout of Character Studio.",
                Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        if (string.IsNullOrWhiteSpace(url) || !url.StartsWith("http", StringComparison.OrdinalIgnoreCase))
        {
            MessageBox.Show(this,
                "Paste an HTTPS URL to CharacterStudio-Runtime.zip.\r\n\r\n" +
                "Build that zip on your machine with Publish-RuntimeBundle.ps1, upload it, then put the link in online-manifest.json.",
                Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        try
        {
            Directory.CreateDirectory(dest);
            string tempZip = Path.Combine(Path.GetTempPath(), "CharacterStudio-Runtime-" + Guid.NewGuid().ToString("N") + ".zip");

            SetBusy(true, "Downloading runtime…");
            _progress.Value = 0;
            DownloadFile(url, tempZip);

            SetBusy(true, "Copying app from Git repo…");
            _progress.Style = ProgressBarStyle.Marquee;
            _progress.MarqueeAnimationSpeed = 30;
            Robocopy(Path.Combine(_repoRoot, "app"), Path.Combine(dest, "app"));
            Robocopy(Path.Combine(_repoRoot, "library"), Path.Combine(dest, "library"));
            Directory.CreateDirectory(Path.Combine(dest, "jobs"));

            string launcherSrc = Path.Combine(_repoRoot, Program.ExeName);
            if (File.Exists(launcherSrc))
                File.Copy(launcherSrc, Path.Combine(dest, Program.ExeName), true);
            else
                BuildLauncher(dest);

            string icoSrc = Path.Combine(_repoRoot, "CharacterStudio.ico");
            if (File.Exists(icoSrc))
                File.Copy(icoSrc, Path.Combine(dest, "CharacterStudio.ico"), true);

            SetBusy(true, "Extracting runtime (large)…");
            string runtimeDir = Path.Combine(dest, "runtime");
            if (Directory.Exists(runtimeDir))
                Directory.Delete(runtimeDir, true);
            Directory.CreateDirectory(runtimeDir);
            ExpandZip(tempZip, runtimeDir);
            try { File.Delete(tempZip); } catch { }

            if (!File.Exists(Path.Combine(dest, "runtime", "python", "pythonw.exe")))
                throw new Exception("Download extracted, but runtime\\python\\pythonw.exe is missing. Check the runtime zip.");

            string uninstallSrc = Path.Combine(_setupDir, "Uninstall.exe");
            if (!File.Exists(uninstallSrc))
                uninstallSrc = Path.Combine(_repoRoot, "installer", "Uninstall.exe");
            if (File.Exists(uninstallSrc))
                File.Copy(uninstallSrc, Path.Combine(dest, "Uninstall.exe"), true);

            SetBusy(true, "Creating shortcuts…");
            string exePath = Path.Combine(dest, Program.ExeName);
            string icoPath = Path.Combine(dest, "CharacterStudio.ico");
            string iconLoc = File.Exists(icoPath) ? icoPath + ",0" : exePath + ",0";
            string startDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
                "Programs", Program.AppName);
            Directory.CreateDirectory(startDir);
            WriteShortcut(Path.Combine(startDir, Program.AppName + ".lnk"), exePath, dest, iconLoc);
            string un = Path.Combine(dest, "Uninstall.exe");
            if (File.Exists(un))
                WriteShortcut(Path.Combine(startDir, "Uninstall " + Program.AppName + ".lnk"), un, dest, iconLoc);
            if (_desktopBox.Checked)
            {
                string desk = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                WriteShortcut(Path.Combine(desk, Program.AppName + ".lnk"), exePath, dest, iconLoc);
            }

            WriteInstallMeta(dest);
            RegisterUninstall(dest, exePath);

            _progress.Style = ProgressBarStyle.Continuous;
            _progress.Value = 100;
            SetBusy(false, "Installed (online).");
            MessageBox.Show(this, Program.AppName + " is installed.\r\n\r\n" + dest,
                Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
            if (_launchBox.Checked)
            {
                Process.Start(new ProcessStartInfo { FileName = exePath, WorkingDirectory = dest, UseShellExecute = true });
            }
            Close();
        }
        catch (Exception ex)
        {
            _progress.Style = ProgressBarStyle.Continuous;
            SetBusy(false, "Install failed.");
            MessageBox.Show(this, ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    void DownloadFile(string url, string destFile)
    {
        using (var wc = new WebClient())
        {
            wc.DownloadProgressChanged += (s, e) =>
            {
                if (e.ProgressPercentage >= 0 && e.ProgressPercentage <= 100)
                {
                    _progress.Style = ProgressBarStyle.Continuous;
                    _progress.Value = e.ProgressPercentage;
                    _status.Text = "Downloading runtime… " + e.ProgressPercentage + "%";
                    Application.DoEvents();
                }
            };
            var task = wc.DownloadFileTaskAsync(new Uri(url), destFile);
            while (!task.IsCompleted)
            {
                Application.DoEvents();
                System.Threading.Thread.Sleep(50);
            }
            if (task.IsFaulted)
                throw task.Exception != null ? task.Exception.GetBaseException() : new Exception("Download failed.");
        }
        if (!File.Exists(destFile) || new FileInfo(destFile).Length < 1000)
            throw new Exception("Download failed or file is empty.");
    }

    static void ExpandZip(string zipPath, string destDir)
    {
        // PowerShell Expand-Archive is reliable on Win10/11.
        string ps =
            "Expand-Archive -LiteralPath '" + zipPath.Replace("'", "''") +
            "' -DestinationPath '" + destDir.Replace("'", "''") + "' -Force";
        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = "-NoProfile -ExecutionPolicy Bypass -Command " + ps,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        using (var p = Process.Start(psi))
        {
            if (p == null) throw new Exception("Could not start PowerShell to extract the zip.");
            p.WaitForExit();
            if (p.ExitCode != 0) throw new Exception("Failed to extract runtime zip.");
        }

        // If the zip contained a top-level "runtime" folder, flatten it.
        string nested = Path.Combine(destDir, "runtime");
        if (Directory.Exists(nested) && !File.Exists(Path.Combine(destDir, "python", "pythonw.exe")))
        {
            foreach (string entry in Directory.GetFileSystemEntries(nested))
            {
                string name = Path.GetFileName(entry);
                string target = Path.Combine(destDir, name);
                if (Directory.Exists(entry))
                {
                    if (Directory.Exists(target)) Directory.Delete(target, true);
                    Directory.Move(entry, target);
                }
                else
                {
                    File.Copy(entry, target, true);
                    File.Delete(entry);
                }
            }
            try { Directory.Delete(nested, true); } catch { }
        }
    }

    void BuildLauncher(string dest)
    {
        string csc = @"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe";
        string src = Path.Combine(_repoRoot, "launcher", "Program.cs");
        string ico = Path.Combine(_repoRoot, "CharacterStudio.ico");
        if (!File.Exists(csc) || !File.Exists(src))
            throw new Exception("CharacterStudio.exe missing and could not be built (need launcher\\Program.cs).");
        string outExe = Path.Combine(dest, Program.ExeName);
        string args = "/nologo /target:winexe /reference:System.Windows.Forms.dll ";
        if (File.Exists(ico)) args += "/win32icon:\"" + ico + "\" ";
        args += "/out:\"" + outExe + "\" \"" + src + "\"";
        var psi = new ProcessStartInfo
        {
            FileName = csc,
            Arguments = args,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        using (var p = Process.Start(psi))
        {
            if (p == null) throw new Exception("Could not build launcher.");
            p.WaitForExit();
            if (p.ExitCode != 0 || !File.Exists(outExe))
                throw new Exception("Building CharacterStudio.exe failed.");
        }
    }

    static void Robocopy(string from, string to)
    {
        Directory.CreateDirectory(to);
        var psi = new ProcessStartInfo
        {
            FileName = "robocopy.exe",
            Arguments = "\"" + from + "\" \"" + to + "\" /E /NFL /NDL /NJH /NJS /NP /R:2 /W:2 /XD __pycache__ .git",
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        using (var p = Process.Start(psi))
        {
            if (p == null) throw new Exception("robocopy failed to start.");
            p.WaitForExit();
            if (p.ExitCode >= 8) throw new Exception("Copy failed (robocopy " + p.ExitCode + ").");
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
            "  \"Version\": " + JsonString(Program.Version) + ",\r\n" +
            "  \"InstallKind\": \"online\"\r\n" +
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
            if (File.Exists(uninstall))
            {
                key.SetValue("UninstallString", "\"" + uninstall + "\"");
                key.SetValue("QuietUninstallString", "\"" + uninstall + "\" /S");
            }
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
    }
}
