// Small launcher. Python, Blender, and ComfyUI stay in runtime/.
// Rebuild from the app root:
// C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /reference:System.Windows.Forms.dll /win32icon:CharacterStudio.ico /out:CharacterStudio.exe launcher\Program.cs
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

static class Program
{
    [STAThread]
    static void Main()
    {
        string root = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
        string python = Path.Combine(root, "runtime", "python", "pythonw.exe");
        string script = Path.Combine(root, "app", "app.py");
        if (!File.Exists(python) || !File.Exists(script))
        {
            MessageBox.Show(
                "Character Studio could not find its Python runtime next to this program.\r\n\r\n" + python,
                "Character Studio",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        var start = new ProcessStartInfo();
        start.FileName = python;
        start.Arguments = "\"" + script + "\"";
        start.WorkingDirectory = root;
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        try
        {
            Process.Start(start);
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Character Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
