// Character Studio Uninstall — WinForms.
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Program
{
    public const string AppName = "Character Studio";
    public const string AppId = "{8F3C2A1B-6D4E-4B9A-A2C1-91E0D7B5F4A3}";

    [STAThread]
    static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        bool quiet = false;
        foreach (string a in args)
        {
            if (string.Equals(a, "/S", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(a, "/silent", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(a, "-Quiet", StringComparison.OrdinalIgnoreCase))
                quiet = true;
        }

        string installDir = Path.GetDirectoryName(Application.ExecutablePath) ?? Environment.CurrentDirectory;
        string meta = Path.Combine(installDir, "install.json");
        if (File.Exists(meta))
        {
            try
            {
                string text = File.ReadAllText(meta);
                int i = text.IndexOf("\"InstallDir\"", StringComparison.OrdinalIgnoreCase);
                if (i >= 0)
                {
                    int q1 = text.IndexOf('"', i + 12);
                    int q2 = text.IndexOf('"', q1 + 1);
                    int q3 = text.IndexOf('"', q2 + 1);
                    if (q2 > 0 && q3 > q2)
                        installDir = text.Substring(q2 + 1, q3 - q2 - 1).Replace("\\\\", "\\");
                }
            }
            catch { }
        }

        if (!quiet)
        {
            DialogResult r = MessageBox.Show(
                "Uninstall " + AppName + " from:\r\n\r\n" + installDir + "\r\n\r\nContinue?",
                AppName, MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (r != DialogResult.Yes) return;
        }

        try
        {
            StopAppProcesses(installDir);
            RemoveShortcuts();
            RemoveRegistry();
            DeleteInstallTree(installDir);
            if (!quiet)
            {
                MessageBox.Show(AppName + " has been uninstalled.", AppName,
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }
        catch (Exception ex)
        {
            if (!quiet)
            {
                MessageBox.Show(ex.Message, AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            Environment.ExitCode = 1;
        }
    }

    static void StopAppProcesses(string installDir)
    {
        foreach (string name in new[] { "CharacterStudio", "pythonw", "python", "blender" })
        {
            Process[] list;
            try { list = Process.GetProcessesByName(name); }
            catch { continue; }
            foreach (Process p in list)
            {
                try
                {
                    string path = "";
                    try { path = p.MainModule != null ? p.MainModule.FileName : ""; } catch { }
                    if (!string.IsNullOrEmpty(path) &&
                        path.StartsWith(installDir, StringComparison.OrdinalIgnoreCase))
                    {
                        p.Kill();
                        p.WaitForExit(3000);
                    }
                }
                catch { }
                finally
                {
                    try { p.Dispose(); } catch { }
                }
            }
        }
    }

    static void RemoveShortcuts()
    {
        string start = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
            "Programs", AppName);
        try { if (Directory.Exists(start)) Directory.Delete(start, true); } catch { }

        string desk = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            AppName + ".lnk");
        try { if (File.Exists(desk)) File.Delete(desk); } catch { }
    }

    static void RemoveRegistry()
    {
        try
        {
            Registry.CurrentUser.DeleteSubKeyTree(
                @"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + AppId, false);
        }
        catch { }
        try
        {
            Registry.LocalMachine.DeleteSubKeyTree(
                @"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + AppId, false);
        }
        catch { }
    }

    static void DeleteInstallTree(string installDir)
    {
        // Delete children first; schedule folder removal after this process exits.
        try
        {
            foreach (string path in Directory.GetFileSystemEntries(installDir))
            {
                try
                {
                    if (Directory.Exists(path)) Directory.Delete(path, true);
                    else File.Delete(path);
                }
                catch { }
            }
        }
        catch { }

        string cmd =
            "/c ping 127.0.0.1 -n 2 >nul & rmdir /s /q \"" + installDir + "\"";
        Process.Start(new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = cmd,
            CreateNoWindow = true,
            UseShellExecute = false,
            WindowStyle = ProcessWindowStyle.Hidden,
        });
        Thread.Sleep(200);
    }
}
